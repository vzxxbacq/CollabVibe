import type { AgentApi, RuntimeConfig, TurnInputItem } from "../../types";
import type { UnifiedAgentEvent } from "../../unified-agent-event";
import { createLogger } from "../../../../logger/src/index";

import { createApprovalOptionMapper } from "./approval-option-mapper";
import { AcpClient } from "./acp-client";
import { createAcpEventFilter } from "./acp-event-bridge";

const log = createLogger("acp-adapter");

export class AcpApiAdapter implements AgentApi {
  readonly backendType = "acp" as const;
  private currentSessionId = "";
  private currentTurnId = "";
  private turnFinished = false;
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
    const result = await this.client.prompt({
      sessionId: this.currentSessionId,
      traceId: params.traceId,
      input: acpInput
    });
    this.currentTurnId = result.turn.id;
    this.turnFinished = false;
    return result;
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
    const opencodeStopReasonOwnsCompletion = this.creationConfig?.backend.backendId === "opencode";
    const filter = createAcpEventFilter({
      ignorePromptResponseCompletion: opencodeStopReasonOwnsCompletion
    });
    this.client.onSessionUpdate((update) => {
      const events = filter(update);
      for (const event of events) {
        if (this.shouldSuppressDuplicateCompletion(event)) {
          continue;
        }
        handler(event);
      }
    });
    this.client.onPromptComplete((result) => {
      if (opencodeStopReasonOwnsCompletion) {
        const completionEvent = this.promptResultToCompletionEvent(result);
        if (completionEvent && !this.shouldSuppressDuplicateCompletion(completionEvent)) {
          handler(completionEvent);
        }
      }
      if (result.usage) {
        handler({
          type: "token_usage",
          turnId: result.turnId,
          input: result.usage.inputTokens ?? 0,
          output: result.usage.outputTokens ?? 0,
          total: result.usage.totalTokens ?? undefined
        });
      }
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

  private promptResultToCompletionEvent(result: {
    turnId?: string;
    stopReason?: string;
  }): UnifiedAgentEvent | null {
    const turnId = result.turnId ?? this.currentTurnId ?? undefined;
    if (result.stopReason === "end_turn") {
      return { type: "turn_complete", turnId };
    }
    if (result.stopReason === "cancelled") {
      return { type: "turn_aborted", turnId };
    }
    return null;
  }

  private shouldSuppressDuplicateCompletion(event: UnifiedAgentEvent): boolean {
    if (event.type !== "turn_complete" && event.type !== "turn_aborted") {
      return false;
    }
    const eventTurnId = event.turnId ?? this.currentTurnId;
    if (!eventTurnId) {
      return this.turnFinished;
    }
    if (this.turnFinished && eventTurnId === this.currentTurnId) {
      return true;
    }
    this.currentTurnId = eventTurnId;
    this.turnFinished = true;
    return false;
  }
}
