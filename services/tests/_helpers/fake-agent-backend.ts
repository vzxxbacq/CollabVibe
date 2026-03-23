import type { AgentApi, AgentApiFactory, RuntimeConfig, AgentTurnInputItem, UnifiedAgentEvent } from "../../../packages/agent-core/src/index";
import type { BackendScriptStep } from "./scripted-backend";
import { firstScriptTurnId } from "./scripted-backend";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FakeAgentApi implements AgentApi {
  readonly backendType = "codex" as const;

  private notificationHandler?: (event: UnifiedAgentEvent) => void;
  private readonly approvals = new Map<string, { resolve: () => void; promise: Promise<void> }>();
  private readonly userInputs = new Map<string, { resolve: () => void; promise: Promise<void> }>();
  private threadCounter = 0;
  private turnCounter = 0;
  private mode: "plan" | "code" = "code";
  private readonly interruptCalls: Array<{ threadId: string; turnId: string }> = [];

  constructor(
    private readonly threadName: string,
    private readonly threadIdPrefix: string,
    private readonly scriptProvider: () => BackendScriptStep[],
  ) {}

  onNotification(handler: (event: UnifiedAgentEvent) => void): void {
    this.notificationHandler = handler;
  }

  async threadStart(_params: RuntimeConfig): Promise<{ thread: { id: string } }> {
    this.threadCounter += 1;
    return { thread: { id: `${this.threadIdPrefix}-${this.threadCounter}` } };
  }

  async threadResume(threadId: string, _params?: RuntimeConfig): Promise<{ thread: { id: string } }> {
    return { thread: { id: threadId } };
  }

  async turnStart(params: { threadId: string; traceId?: string; input: AgentTurnInputItem[] }): Promise<{ turn: { id: string } }> {
    void params;
    this.turnCounter += 1;
    const script = this.scriptProvider();
    const turnId = firstScriptTurnId(script) ?? `${this.threadName}-turn-${this.turnCounter}`;
    void this.play(script);
    return { turn: { id: turnId } };
  }

  async setMode(mode: "plan" | "code"): Promise<void> {
    this.mode = mode;
    void this.mode;
  }

  async respondApproval(params: {
    action: "approve" | "deny" | "approve_always";
    approvalId: string;
  }): Promise<void> {
    void params.action;
    this.approvals.get(params.approvalId)?.resolve();
  }

  async respondUserInput(params: {
    callId: string;
    answers: Record<string, string[]>;
  }): Promise<void> {
    void params.answers;
    this.userInputs.get(params.callId)?.resolve();
  }

  async turnInterrupt(threadId: string, turnId: string): Promise<void> {
    this.interruptCalls.push({ threadId, turnId });
    return;
  }

  getInterruptCalls(): Array<{ threadId: string; turnId: string }> {
    return [...this.interruptCalls];
  }

  async threadRollback(_threadId: string, _numTurns?: number): Promise<void> {
    return;
  }

  private emit(event: UnifiedAgentEvent): void {
    this.notificationHandler?.(event);
  }

  private waitForApproval(approvalId: string): Promise<void> {
    const existing = this.approvals.get(approvalId);
    if (existing) return existing.promise;
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    this.approvals.set(approvalId, { resolve, promise });
    return promise;
  }

  private waitForUserInput(callId: string): Promise<void> {
    const existing = this.userInputs.get(callId);
    if (existing) return existing.promise;
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    this.userInputs.set(callId, { resolve, promise });
    return promise;
  }

  private async play(script: BackendScriptStep[]): Promise<void> {
    for (const step of script) {
      switch (step.type) {
        case "event":
          this.emit(step.event);
          break;
        case "sleep":
          await delay(step.ms);
          break;
        case "wait_approval":
          await this.waitForApproval(step.approvalId);
          break;
        case "wait_user_input":
          await this.waitForUserInput(step.callId);
          break;
      }
    }
  }
}

export class FakeAgentApiFactory implements AgentApiFactory {
  private readonly scripts = new Map<string, BackendScriptStep[]>();
  private readonly apis = new Set<FakeAgentApi>();
  private readonly apiByThreadName = new Map<string, FakeAgentApi>();
  private readonly interruptHistoryByThreadName = new Map<string, Array<{ threadId: string; turnId: string }>>();

  setScript(threadName: string, script: BackendScriptStep[]): void {
    this.scripts.set(threadName, script);
  }

  async create(config: RuntimeConfig & { projectId: string; userId?: string; threadName: string }): Promise<AgentApi> {
    void config.projectId;
    void config.userId;
    const threadIdPrefix = `${config.projectId}-${config.threadName}-thread`;
    const api = new FakeAgentApi(config.threadName, threadIdPrefix, () => this.scripts.get(config.threadName) ?? []);
    this.apis.add(api);
    this.apiByThreadName.set(config.threadName, api);
    return api;
  }

  getApi(threadName: string): FakeAgentApi | undefined {
    return this.apiByThreadName.get(threadName);
  }

  getInterruptCalls(threadName: string): Array<{ threadId: string; turnId: string }> {
    const live = this.apiByThreadName.get(threadName)?.getInterruptCalls() ?? [];
    const history = this.interruptHistoryByThreadName.get(threadName) ?? [];
    return [...history, ...live];
  }

  async dispose(api: AgentApi): Promise<void> {
    if (api instanceof FakeAgentApi) {
      this.apis.delete(api);
      for (const [threadName, existing] of this.apiByThreadName.entries()) {
        if (existing === api) {
          const history = this.interruptHistoryByThreadName.get(threadName) ?? [];
          history.push(...existing.getInterruptCalls());
          this.interruptHistoryByThreadName.set(threadName, history);
          this.apiByThreadName.delete(threadName);
        }
      }
    }
  }

  async healthCheck(_api: AgentApi): Promise<{ alive: boolean; threadCount: number }> {
    return { alive: true, threadCount: this.apis.size };
  }
}
