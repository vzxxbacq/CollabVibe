import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { AgentApi, RuntimeConfig, AgentApiFactory, TurnInputItem } from "../../types";
import type { ManagedProcess, ProcessSpawnConfig } from "../../agent-process-manager";
import { MAIN_THREAD_NAME } from "../../constants";
import { StdioRpcTransport } from "../../stdio-transport";
import { JsonRpcClient } from "../../rpc-client";
import type { RpcNotification } from "../../rpc-types";
import { CodexClient } from "./codex-client";
import { codexServerRequestToUnifiedEvent } from "./codex-event-bridge";
import type { ModeKind } from "./generated/ModeKind";
import { createLogger } from "../../../../logger/src/index";

const log = createLogger("codex-factory");

interface ProcessManagerPort {
  start(chatId: string, runtimeConfig: ProcessSpawnConfig): Promise<ManagedProcess>;
  stop?(chatId: string): Promise<void>;
}

interface CodexApiWithNotifications extends AgentApi {
  onNotification(handler: (notification: RpcNotification) => void): void;
  close(): void;
  isAlive(): boolean;
}

function toChildProcess(process: ManagedProcess): ChildProcessWithoutNullStreams {
  if (!process.stdin || !process.stdout) {
    throw new Error("codex process does not expose stdin/stdout");
  }
  return process as unknown as ChildProcessWithoutNullStreams;
}

class CodexProtocolAdapter implements CodexApiWithNotifications {
  readonly backendType = "codex" as const;
  private pendingMode: ModeKind = "default";

  constructor(
    private readonly client: CodexClient,
    private readonly transport: StdioRpcTransport,
    private readonly process: ManagedProcess,
    /** Model from RuntimeConfig.backend.model — set at factory create() time (I3 compliant) */
    private readonly model: string,
    private readonly rpc: JsonRpcClient,
    private readonly correlation: { chatId: string; threadName: string }
  ) { }

  async threadStart(params: RuntimeConfig): Promise<{ thread: { id: string } }> {
    // D2: Map RuntimeConfig → Codex ThreadStartParams
    return this.client.threadStart({
      model: params.backend.model,
      cwd: params.cwd,
      sandbox: params.sandbox as import("./types").SandboxPolicy,
      approvalPolicy: params.approvalPolicy,
      personality: params.personality,
      serviceName: params.serviceName,
    });
  }

  async turnStart(params: { threadId: string; traceId?: string; input: TurnInputItem[] }): Promise<{ turn: { id: string } }> {
    const turnMode = this.pendingMode === "plan" ? "plan" : "code";
    this.transport.setLogCorrelation({ ...this.correlation, turnMode, turnId: undefined });
    this.rpc.setLogCorrelation({ ...this.correlation, turnMode, turnId: undefined });
    // Map rich TurnInputItem[] to Codex-native input format
    const codexInput = params.input.map(item => {
      switch (item.type) {
        case "text": return { type: "text" as const, text: item.text };
        case "skill": return { type: "skill" as const, name: item.name, path: item.path };
        case "file_mention": return { type: "text" as const, text: `[请重点关注文件: ${item.path}]` };
        case "local_image": return { type: "localImage" as const, path: item.path };
      }
    });
    const turnParams: Record<string, unknown> = {
      threadId: params.threadId,
      input: codexInput,
    };
    if (params.traceId) turnParams.traceId = params.traceId;
    // Always send collaborationMode to ensure Codex agent mode stays in sync.
    // Without this, a prior /plan turn would leave the agent in plan mode
    // because the server preserves the last-set mode across turns.
    // settings.model from constructor (I3: sourced from ThreadRecord.backend.model)
    turnParams.collaborationMode = {
      mode: this.pendingMode,
      settings: { model: this.model, reasoning_effort: null, developer_instructions: null }
    };
    const result = await this.client.turnStart(turnParams as unknown as Parameters<CodexClient["turnStart"]>[0]);
    this.transport.setLogCorrelation({ ...this.correlation, turnMode, turnId: result.turn.id });
    this.rpc.setLogCorrelation({ ...this.correlation, turnMode, turnId: result.turn.id });
    // Reset pending mode after turn start
    this.pendingMode = "default";
    return result;
  }

  async setMode(mode: "plan" | "code"): Promise<void> {
    this.pendingMode = mode === "plan" ? "plan" : "default";
    const turnMode = this.pendingMode === "plan" ? "plan" : "code";
    this.transport.setLogCorrelation({ ...this.correlation, turnMode });
    this.rpc.setLogCorrelation({ ...this.correlation, turnMode });
  }

  async threadResume(threadId: string): Promise<{ thread: { id: string } }> {
    return this.client.threadResume(threadId);
  }

  async respondApproval(params: {
    action: "approve" | "deny" | "approve_always";
    approvalId: string;
    threadId?: string;
    turnId?: string;
    callId?: string;
    approvalType?: "command_exec" | "file_change";
  }): Promise<void> {
    // v2 CommandExecutionApprovalDecision / FileChangeApprovalDecision:
    //   "accept" | "acceptForSession" | "decline" | "cancel"
    const decision = params.action === "approve" ? "accept"
      : params.action === "deny" ? "decline"
        : "acceptForSession";
    await this.transport.respondToServerRequest(params.approvalId, { decision });
  }

  async respondUserInput(params: { callId: string; answers: Record<string, string[]> }): Promise<void> {
    // Codex ToolRequestUserInputResponse: { answers: { [questionId]: { answers: string[] } } }
    const response: Record<string, { answers: string[] }> = {};
    for (const [qId, values] of Object.entries(params.answers)) {
      response[qId] = { answers: values };
    }
    await this.transport.respondToServerRequest(params.callId, { answers: response });
  }

  onNotification(handler: (notification: RpcNotification) => void): void {
    // Legacy notifications (events without id)
    this.transport.onNotification(handler);
    // Server-initiated requests (approvals with id) — pass the UnifiedAgentEvent directly.
    // DO NOT wrap as { method, params: event } — that causes the pipeline's toUnified()
    // to re-parse it through the legacy codexEventToUnifiedAgentEvent, which remaps
    // approvalId incorrectly (falls back to callId instead of the JSON-RPC request id).
    this.transport.onServerRequest((request) => {
      const event = codexServerRequestToUnifiedEvent(request);
      if (event) {
        handler(event as unknown as RpcNotification);
      } else {
        // Auto-reject unhandled server requests to prevent turn hang.
        // e.g. item/tool/call, account/chatgptAuthTokens/refresh
        log.warn({ method: request.method, id: request.id }, "auto-rejecting unhandled server request");
        this.transport.rejectServerRequest(request.id,
          -32601,
          `Method ${request.method} not supported in IM bot mode`
        ).catch((err) => log.error({ err }, "failed to reject server request"));
      }
    });
  }

  isAlive(): boolean {
    return this.process.exitCode === null;
  }

  close(): void {
    this.transport.close();
  }
}

export class CodexProtocolApiFactory implements AgentApiFactory {
  private readonly metadata = new WeakMap<AgentApi, { bindingChatId: string; threadName?: string }>();

  constructor(
    private readonly processManager: ProcessManagerPort,
    private readonly clientInfo: { name: string; title: string; version: string } = {
      name: "agent-im-server",
      title: "Agent IM Bot",
      version: "0.1.0"
    }
  ) { }

  async create(config: RuntimeConfig & { chatId: string; userId?: string }): Promise<CodexApiWithNotifications> {
    const projectThreadProcessKey = `${config.chatId}:${config.threadName ?? MAIN_THREAD_NAME}`;
    const process = await this.processManager.start(projectThreadProcessKey, {
      serverCmd: config.serverCmd,
      cwd: config.cwd,
      env: config.env
    });

    const correlation = { chatId: config.chatId, threadName: config.threadName ?? MAIN_THREAD_NAME };
    const transport = new StdioRpcTransport(toChildProcess(process), correlation);
    const rpc = new JsonRpcClient(transport, correlation);
    const client = new CodexClient(rpc);
    await client.initialize({
      clientInfo: this.clientInfo,
      capabilities: { experimentalApi: true }
    });

    const api = new CodexProtocolAdapter(client, transport, process, config.backend.model, rpc, correlation);
    this.metadata.set(api, { bindingChatId: config.chatId, threadName: config.threadName });
    return api;
  }

  async dispose(api: AgentApi): Promise<void> {
    if (typeof (api as Partial<CodexApiWithNotifications>).close === "function") {
      (api as CodexApiWithNotifications).close();
    }
    const meta = this.metadata.get(api);
    if (meta && this.processManager.stop) {
      await this.processManager.stop(`${meta.bindingChatId}:${meta.threadName ?? MAIN_THREAD_NAME}`);
    }
  }

  async healthCheck(api: AgentApi): Promise<{ alive: boolean; threadCount: number }> {
    const alive = typeof (api as Partial<CodexApiWithNotifications>).isAlive === "function"
      ? (api as CodexApiWithNotifications).isAlive()
      : true;
    return {
      alive,
      threadCount: 0
    };
  }
}
