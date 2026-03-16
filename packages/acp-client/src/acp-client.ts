import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { StdioRpcTransport } from "../../agent-core/src/stdio-transport";
import { createLogger } from "../../../packages/channel-core/src/index";
import type { BackendRpcCorrelation } from "../../agent-core/src/rpc-client";

import type { AcpSessionUpdate } from "./types";

const log = createLogger("acp-rpc");

export interface AcpPromptResult {
  turnId?: string;
  stopReason?: string;
  usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
}

export class AcpClient {
  private readonly transport: StdioRpcTransport;
  private correlation: BackendRpcCorrelation;

  constructor(process: ChildProcessWithoutNullStreams, correlation: BackendRpcCorrelation = {}) {
    this.transport = new StdioRpcTransport(process, correlation);
    this.correlation = { ...correlation };
  }

  setLogCorrelation(correlation: Partial<BackendRpcCorrelation>): void {
    this.correlation = { ...this.correlation, ...correlation };
    this.transport.setLogCorrelation(this.correlation);
  }

  async initialize(): Promise<void> {
    await this.transport.notify("initialize", { protocol: "acp" });
  }

  async sessionNew(params: Record<string, unknown>): Promise<{ session: { id: string } }> {
    log.debug({ method: "session/new", paramKeys: Object.keys(params) }, "sending session/new");
    const response = await this.transport.request<Record<string, unknown>>({
      id: `acp-${Date.now()}-new`,
      method: "session/new",
      params: {
        ...params,
        mcpServers: (params.mcpServers as unknown[]) ?? []
      }
    });
    const anyResp = response as unknown as { error?: { message?: string } };
    if (anyResp.error) {
      throw new Error(`session/new failed: ${anyResp.error.message ?? JSON.stringify(anyResp.error)}`);
    }
    const result = response.result as Record<string, unknown> | undefined;
    // opencode returns { sessionId: "..." }, ACP spec uses { session: { id: "..." } }
    const sessionId = String(
      result?.sessionId ??
      (result?.session as Record<string, unknown> | undefined)?.id ??
      ""
    );
    log.debug({ sessionId, resultKeys: result ? Object.keys(result) : [] }, "session/new response");
    return { session: { id: sessionId } };
  }

  async sessionLoad(sessionId: string, params?: Record<string, unknown>): Promise<{ session: { id: string } }> {
    const response = await this.transport.request<{ session?: { id?: string } }>({
      id: `acp-${Date.now()}-load`,
      method: "session/load",
      params: {
        sessionId,
        cwd: (params?.cwd as string) ?? process.cwd(),
        mcpServers: (params?.mcpServers as unknown[]) ?? [],
        ...params
      }
    });
    const anyResp = response as unknown as { error?: { message?: string } };
    if (anyResp.error) {
      throw new Error(`session/load failed: ${anyResp.error.message ?? JSON.stringify(anyResp.error)}`);
    }
    return { session: { id: String(response.result?.session?.id ?? sessionId) } };
  }

  async prompt(params: Record<string, unknown>): Promise<{ turn: { id: string } }> {
    // opencode ACP expects 'prompt' field, not 'input'
    const prompt = (params.prompt as unknown[]) ?? (params.input as unknown[]);
    const sessionId = String(params.sessionId ?? "");
    log.debug({ sessionId, promptLength: Array.isArray(prompt) ? prompt.length : 0 }, "sending session/prompt");
    // Send as request but don't await — opencode processes asynchronously and
    // sends streaming session/update notifications. The RPC response arrives
    // only when the turn completes (could be minutes).
    const requestId = `acp-${Date.now()}-prompt`;
    // Use requestId as the unique turnId — sessionId is shared across all turns
    // on the same session, which causes the EventPipeline dedup to block
    // subsequent turns from completing.
    const turnId = requestId;
    this.setLogCorrelation({ turnId });
    this.transport.request<Record<string, unknown>>({
      id: requestId,
      method: "session/prompt",
      params: {
        sessionId,
        traceId: params.traceId,
        prompt
      }
    }, 10 * 60_000).then((resp) => {
      const anyResp = resp as unknown as { error?: { message?: string } };
      if (anyResp.error) {
        log.error({ sessionId, err: anyResp.error.message }, "session/prompt completed with error");
      } else {
        const result = resp.result as Record<string, unknown> | undefined;
        log.debug({ sessionId, resultKeys: result ? Object.keys(result) : [] }, "session/prompt completed");
        // Emit prompt completion event for turn_complete + token_usage
        if (this.promptCompleteHandler && result) {
          const usage = result.usage as { totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined;
          this.promptCompleteHandler({
            turnId,
            stopReason: String(result.stopReason ?? "end_turn"),
            usage: usage ?? undefined
          });
        }
      }
    }).catch((err) => {
      log.error({ sessionId, err: err instanceof Error ? err.message : String(err) }, "session/prompt failed");
    });
    log.debug({ sessionId, requestId, turnId }, "session/prompt dispatched");
    return { turn: { id: turnId } };
  }

  async cancel(sessionId: string, turnId: string): Promise<void> {
    await this.transport.notify("session/cancel", { sessionId, turnId });
  }

  async setMode(sessionId: string, mode: "plan" | "code"): Promise<void> {
    this.setLogCorrelation({ turnMode: mode });
    log.debug({ sessionId, mode }, "sending session/set_mode");
    const response = await this.transport.request<Record<string, unknown>>({
      id: `acp-${Date.now()}-mode`,
      method: "session/set_mode",
      params: { sessionId, modeId: mode }
    });
    const anyResp = response as unknown as { error?: { message?: string } };
    if (anyResp.error) {
      throw new Error(`session/set_mode failed: ${anyResp.error.message ?? JSON.stringify(anyResp.error)}`);
    }
  }

  async respondApproval(sessionId: string, toolCallId: string, selectedOptionId: string): Promise<void> {
    await this.transport.notify("session/request_permission/respond", { sessionId, toolCallId, selectedOptionId });
  }

  onSessionUpdate(handler: (update: AcpSessionUpdate) => void): void {
    this.transport.onNotification((notification) => {
      const params = notification.params as Record<string, unknown>;
      if (notification.method === "session/update" && typeof params === "object") {
        // opencode sends { sessionId, update: { sessionUpdate: "...", ... } }
        const inner = params.update as Record<string, unknown> | undefined;
        if (inner && typeof inner === "object") {
          handler(inner as AcpSessionUpdate);
        } else {
          // fallback: params itself is the update
          handler(params as AcpSessionUpdate);
        }
      }
    });
  }

  private promptCompleteHandler?: (result: AcpPromptResult) => void;

  onPromptComplete(handler: (result: AcpPromptResult) => void): void {
    this.promptCompleteHandler = handler;
  }

  onElicitationRequest(handler: (request: {
    id: string | number;
    message?: string;
    mode?: string;
    [key: string]: unknown;
  }) => void): void {
    this.transport.onServerRequest((request) => {
      if (request.method === "session/elicitation") {
        handler({ id: request.id, ...request.params });
      } else {
        // Auto-reject unknown ACP server requests
        this.transport.rejectServerRequest(request.id,
          -32601, `Method ${request.method} not supported`
        ).catch(() => { /* best-effort */ });
      }
    });
  }

  close(): void {
    this.transport.close();
  }
}
