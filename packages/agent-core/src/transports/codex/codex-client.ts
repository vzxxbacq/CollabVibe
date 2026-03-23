import { JsonRpcClient } from "../../rpc-client";
import { toProtocolDecision, type ApprovalRequestEvent } from "./approval";
import { createLogger } from "../../../../logger/src/index";
import type {
  ApplyPatchApprovalDecisionParams,
  CodexInitializeParams,
  ExecApprovalDecisionParams,
  ThreadResult,
  ThreadStartParams,
  TurnStatusUpdate,
  TurnResult,
  TurnStartParams
} from "./types";

const log = createLogger("codex-factory");

export class CodexClient {
  private readonly rpc: JsonRpcClient;

  private readonly turnStatus = new Map<string, TurnStatusUpdate>();

  private readonly approvalIndex = new Map<
    string,
    { type: ApprovalRequestEvent["type"]; threadId: string; turnId: string; callId: string }
  >();

  private readonly turnStatusListeners = new Set<(update: TurnStatusUpdate) => void>();

  constructor(rpc: JsonRpcClient) {
    this.rpc = rpc;
  }

  private emitTurnStatus(update: TurnStatusUpdate): void {
    this.turnStatus.set(update.turnId, update);
    for (const listener of this.turnStatusListeners) {
      listener(update);
    }
  }

  async initialize(params: CodexInitializeParams): Promise<void> {
    log.debug("codex client initialize");
    await this.rpc.initialize(params as Parameters<JsonRpcClient["initialize"]>[0]);
  }

  async threadStart(params: ThreadStartParams): Promise<ThreadResult> {
    log.debug({ cwd: params.cwd, model: params.model }, "codex thread/start");
    return this.rpc.call<ThreadResult>("thread/start", params as unknown as Record<string, unknown>);
  }

  async threadResume(threadId: string): Promise<ThreadResult> {
    log.debug({ threadId }, "codex thread/resume");
    return this.rpc.call<ThreadResult>("thread/resume", { threadId });
  }

  async threadFork(threadId: string): Promise<ThreadResult> {
    return this.rpc.call<ThreadResult>("thread/fork", { threadId });
  }

  async turnStart(params: TurnStartParams): Promise<TurnResult> {
    log.debug({ threadId: params.threadId, inputItems: params.input.length }, "codex turn/start");
    const result = await this.rpc.call<TurnResult>("turn/start", params as unknown as Record<string, unknown>);
    this.emitTurnStatus({
      threadId: params.threadId,
      turnId: result.turn.id,
      status: result.turn.status
    });
    return result;
  }

  async turnInterrupt(threadId: string, turnId: string): Promise<void> {
    log.debug({ threadId, turnId }, "codex turn/interrupt");
    await this.rpc.call("turn/interrupt", { threadId, turnId });
    this.emitTurnStatus({
      threadId,
      turnId,
      status: "interrupted"
    });
  }

  async threadRollback(threadId: string, numTurns = 1): Promise<void> {
    log.debug({ threadId, numTurns }, "codex thread/rollback");
    await this.rpc.call("thread/rollback", { threadId, numTurns });
  }

  trackApprovalRequest(event: ApprovalRequestEvent): void {
    const turn = this.turnStatus.get(event.turnId);
    if (!turn) {
      return;
    }
    this.approvalIndex.set(event.requestId, {
      type: event.type,
      threadId: turn.threadId,
      turnId: event.turnId,
      callId: event.callId
    });
  }

  getApprovalContext(requestId: string): { type: ApprovalRequestEvent["type"]; threadId: string; turnId: string; callId: string } | null {
    return this.approvalIndex.get(requestId) ?? null;
  }

  async respondExecApproval(params: ExecApprovalDecisionParams): Promise<void> {
    await this.rpc.call("execCommandApproval/respond", {
      requestId: params.requestId,
      conversationId: params.threadId,
      turnId: params.turnId,
      callId: params.callId,
      response: {
        decision: toProtocolDecision(params.decision)
      }
    });
  }

  async respondApplyPatchApproval(params: ApplyPatchApprovalDecisionParams): Promise<void> {
    await this.rpc.call("applyPatchApproval/respond", {
      requestId: params.requestId,
      conversationId: params.threadId,
      turnId: params.turnId,
      callId: params.callId,
      response: {
        decision: toProtocolDecision(params.decision)
      }
    });
  }

  getTurnStatus(turnId: string): TurnStatusUpdate | null {
    return this.turnStatus.get(turnId) ?? null;
  }

  onTurnStatusUpdate(listener: (update: TurnStatusUpdate) => void): () => void {
    this.turnStatusListeners.add(listener);
    return () => {
      this.turnStatusListeners.delete(listener);
    };
  }

  // ── Skill / Plugin APIs (B1) ───────────────────────────────────────────

  /**
   * List skills discovered by Codex (skills/list).
   */
  async skillsList(params: {
    cwds: string[];
    forceReload?: boolean;
    perCwdExtraUserRoots?: Record<string, string[]>;
  }): Promise<Array<{ cwd: string; skills: Array<{ name: string; path: string; enabled: boolean }>; errors: Array<unknown> }>> {
    return this.rpc.call("skills/list", params as unknown as Record<string, unknown>);
  }

  /**
   * Enable or disable a skill by path (skills/config/write).
   */
  async skillsConfigWrite(params: {
    path: string;
    enabled: boolean;
  }): Promise<void> {
    await this.rpc.call("skills/config/write", params as unknown as Record<string, unknown>);
  }

  /**
   * Install a plugin from Codex marketplace (plugin/install).
   */
  async pluginInstall(params: {
    marketplaceName: string;
    pluginName: string;
    cwd?: string | null;
  }): Promise<unknown> {
    return this.rpc.call("plugin/install", params as unknown as Record<string, unknown>, 60_000);
  }
}
