import type { AgentApi, RuntimeConfig, TurnInputItem } from "../../agent-core/src/types";
import type { UnifiedAgentEvent } from "../../agent-core/src/unified-agent-event";
import { createLogger } from "../../../packages/channel-core/src/index";

import { createApprovalOptionMapper } from "./approval-option-mapper";
import { AcpClient } from "./acp-client";
import { createAcpEventFilter } from "./acp-event-bridge";

const log = createLogger("acp-adapter");

export class AcpApiAdapter implements AgentApi {
  readonly backendType = "acp" as const;
  private currentSessionId = "";
  /** Whether a session has been established in this process (via sessionNew or sessionLoad) */
  private sessionEstablished = false;
  /** RuntimeConfig from factory creation — used for auto-load fallback */
  private creationConfig?: RuntimeConfig;
  private readonly optionMapper = createApprovalOptionMapper();
  /** Callback to persist session ID changes to the database */
  private sessionIdChangedCallback?: (newSessionId: string) => void;

  constructor(private readonly client: AcpClient) { }

  /** Called by AcpAgentApiFactory after creation to store the config */
  setCreationConfig(config: RuntimeConfig): void {
    this.creationConfig = config;
  }

  /** Initialize from persisted backendSessionId (read from DB binding) */
  setBackendSessionId(sessionId: string): void {
    if (sessionId) {
      this.currentSessionId = sessionId;
    }
  }

  /** Register callback for when session ID changes (for DB persistence) */
  onSessionIdChanged(callback: (newSessionId: string) => void): void {
    this.sessionIdChangedCallback = callback;
  }

  /**
   * Eagerly establish an ACP session by loading a persisted session ID.
   * Called by AcpApiFactory after creation for existing threads.
   * Throws on failure — does NOT fallback to session/new to avoid silent context loss.
   */
  async ensureSession(sessionId: string, config: RuntimeConfig): Promise<void> {
    try {
      await this.threadResume(sessionId, config);
      log.info({ sessionId }, "ensureSession: session/load succeeded");
    } catch (loadErr) {
      const errMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      log.error({ sessionId, err: errMsg }, "ensureSession: session/load failed");
      throw new Error(
        `Thread 的 ACP session 已失效 (${sessionId})，上下文不可恢复。请使用 /thread new 创建新 thread`
      );
    }
  }

  async threadStart(params: RuntimeConfig): Promise<{ thread: { id: string } }> {
    const response = await this.client.sessionNew(params as unknown as Record<string, unknown>);
    this.currentSessionId = response.session.id;
    this.sessionEstablished = true;
    // Notify caller to persist the new session ID
    this.sessionIdChangedCallback?.(response.session.id);
    return { thread: { id: response.session.id } };
  }

  async threadResume(threadId: string, params?: RuntimeConfig): Promise<{ thread: { id: string } }> {
    const response = await this.client.sessionLoad(threadId, params as unknown as Record<string, unknown> | undefined);
    this.currentSessionId = response.session.id;
    this.sessionEstablished = true;
    return { thread: { id: response.session.id } };
  }

  async turnStart(params: { threadId: string; traceId?: string; input: TurnInputItem[] }): Promise<{ turn: { id: string } }> {
    if (!this.sessionEstablished) {
      throw new Error("ACP session not established — call ensureSession() or threadStart() first");
    }
    // Map rich TurnInputItem[] to ACP-native input format
    const acpInput = params.input.map(item => {
      switch (item.type) {
        case "text": return { type: "text" as const, text: item.text };
        case "skill": return { type: "text" as const, text: `[使用 Skill: ${item.name}, 参考 ${item.path}/SKILL.md]` };
        case "file_mention": return { type: "text" as const, text: `[请重点关注文件: ${item.path}]` };
        case "local_image": return { type: "image" as const, source: { type: "file" as const, path: item.path } };
      }
    });
    return this.client.prompt({
      sessionId: this.currentSessionId,
      traceId: params.traceId,
      input: acpInput
    });
  }

  async setMode(mode: "plan" | "code"): Promise<void> {
    if (!this.sessionEstablished) {
      log.warn("setMode called before session established — skipping");
      return;
    }
    this.client.setLogCorrelation({ turnMode: mode });
    await this.client.setMode(this.currentSessionId, mode);
  }

  async turnInterrupt(threadId: string, turnId: string): Promise<void> {
    const sessionId = this.currentSessionId || threadId;
    log.info({ sessionId, turnId, originalThreadId: threadId }, "cancelling session");
    await this.client.cancel(sessionId, turnId);
  }

  async threadRollback(): Promise<void> {
    return;
  }

  async respondApproval(params: { action: "approve" | "deny" | "approve_always"; approvalId: string; threadId?: string; turnId?: string; callId?: string; approvalType?: "command_exec" | "file_change"; }): Promise<void> {
    const selectedOptionId = this.optionMapper.toOptionId(params.action) ?? "deny";
    const sessionId = this.currentSessionId;
    await this.client.respondApproval(sessionId, params.approvalId, selectedOptionId);
  }

  onNotification(handler: (notification: UnifiedAgentEvent) => void): void {
    const filter = createAcpEventFilter();
    this.client.onSessionUpdate((update) => {
      const events = filter(update);
      for (const event of events) {
        handler(event);
      }
    });
    // When the prompt response arrives (end of turn), emit turn_complete + token_usage
    this.client.onPromptComplete((result) => {
      if (result.usage) {
        handler({
          type: "token_usage",
          turnId: result.turnId,
          input: result.usage.inputTokens ?? 0,
          output: result.usage.outputTokens ?? 0,
          total: result.usage.totalTokens ?? undefined
        });
      }
      handler({
        type: "turn_complete",
        turnId: result.turnId,
        lastAgentMessage: undefined
      });
    });
    // ACP session/elicitation server-initiated request → user_input event
    this.client.onElicitationRequest((req) => {
      handler({
        type: "user_input",
        turnId: "",
        callId: String(req.id),
        questions: [{ text: String(req.message ?? "需要用户输入") }]
      });
    });
  }

  close(): void {
    this.client.close();
  }
}
