import type {
  IMNotification,
  IMOutputMessage,
  IMPlanUpdate,
  IMProgressEvent,
  IMTurnSummary,
} from "./im-output";

export interface TurnRuntimeToolCall {
  label: string;
  tool: IMProgressEvent["tool"];
  callId?: string;
  status: "running" | "completed" | "failed";
  targetFile?: string;
  exitCode?: number;
  duration?: string;
  summary?: string;
  agentId?: string;
}

export interface TurnRuntimeToolOutput {
  callId: string;
  command: string;
  output: string;
}

export interface TurnStateSnapshot {
  threadId: string;
  turnId: string;
  threadName?: string;
  promptSummary?: string;
  backendName?: string;
  modelName?: string;
  turnMode?: "plan";
  content: string;
  reasoning: string;
  planDraft: string;
  plan?: IMPlanUpdate["plan"];
  planExplanation?: string;
  tools: TurnRuntimeToolCall[];
  toolOutputs: Array<TurnRuntimeToolOutput>;
  tokenUsage?: { input: number; output: number; total?: number };
  duration: number;
}

export class TurnState {
  private readonly startedAt: number;
  private tokenUsage: { input: number; output: number; total?: number } | undefined;
  private content = "";
  private reasoning = "";
  private planDraft = "";
  private plan?: IMPlanUpdate["plan"];
  private planExplanation?: string;
  private promptSummary: string | undefined;
  private backendName: string | undefined;
  private modelName: string | undefined;
  private turnMode: "plan" | undefined;
  private readonly tools: TurnRuntimeToolCall[] = [];
  private readonly toolOutputs = new Map<string, TurnRuntimeToolOutput>();

  constructor(
    private readonly threadId: string,
    private readonly turnId: string,
    private readonly threadName?: string,
    private readonly now: () => number = () => Date.now()
  ) {
    this.startedAt = this.now();
  }

  appendContent(delta: string | undefined): void {
    if (!delta) return;
    this.content += delta;
  }

  appendReasoning(delta: string | undefined): void {
    if (!delta) return;
    this.reasoning += delta;
  }

  appendPlan(delta: string | undefined): void {
    if (!delta) return;
    this.planDraft += delta;
  }

  replacePlan(update: Pick<IMPlanUpdate, "explanation" | "plan">): void {
    this.planExplanation = update.explanation;
    this.plan = update.plan;
    this.planDraft = "";
  }

  appendToolOutput(chunk: { callId: string; delta: string }): void {
    const existing = this.toolOutputs.get(chunk.callId);
    if (existing) {
      existing.output += chunk.delta;
      return;
    }
    const relatedTool = [...this.tools].reverse().find((tool) => tool.callId === chunk.callId);
    this.toolOutputs.set(chunk.callId, {
      callId: chunk.callId,
      command: relatedTool?.label ?? chunk.callId,
      output: chunk.delta,
    });
  }

  applyProgress(event: IMProgressEvent): void {
    if (event.phase === "begin") {
      this.tools.push({
        label: event.label,
        tool: event.tool,
        callId: event.callId,
        status: "running",
        targetFile: event.targetFile,
        agentId: event.agentId,
      });
      return;
    }
    const existing = [...this.tools].reverse().find((tool) => {
      if (event.callId && tool.callId === event.callId) {
        return true;
      }
      return tool.label === event.label && tool.tool === event.tool;
    });
    if (existing) {
      existing.status = event.status === "failed" ? "failed" : "completed";
      existing.targetFile = event.targetFile ?? existing.targetFile;
      existing.exitCode = event.exitCode ?? existing.exitCode;
      existing.duration = event.duration ?? existing.duration;
      existing.summary = event.summary ?? existing.summary;
      existing.agentId = event.agentId ?? existing.agentId;
    } else {
      this.tools.push({
        label: event.label,
        tool: event.tool,
        callId: event.callId,
        status: event.status === "failed" ? "failed" : "completed",
        targetFile: event.targetFile,
        exitCode: event.exitCode,
        duration: event.duration,
        summary: event.summary,
        agentId: event.agentId,
      });
    }
  }

  setTokenUsage(tokenUsage: { input: number; output: number; total?: number } | undefined): void {
    this.tokenUsage = tokenUsage;
  }

  applyMetadata(metadata: {
    promptSummary?: string;
    backendName?: string;
    modelName?: string;
    turnMode?: "plan";
  }): void {
    this.promptSummary = metadata.promptSummary ?? this.promptSummary;
    this.backendName = metadata.backendName ?? this.backendName;
    this.modelName = metadata.modelName ?? this.modelName;
    this.turnMode = metadata.turnMode ?? this.turnMode;
  }

  /** @deprecated compatibility shim; canonical source is content */
  setLastAgentMessage(message: string | undefined): void {
    if (message && !this.content) {
      this.content = message;
    }
  }

  applyNotification(notification: IMNotification): void {
    if (notification.category === "token_usage") {
      this.setTokenUsage(notification.tokenUsage);
      return;
    }
    if ((notification.category === "agent_message" || notification.category === "turn_complete") && notification.lastAgentMessage && !this.content) {
      this.content = notification.lastAgentMessage;
    }
  }

  applyOutputMessage(message: IMOutputMessage): void {
    switch (message.kind) {
      case "content":
        this.appendContent(message.delta);
        break;
      case "reasoning":
        this.appendReasoning(message.delta);
        break;
      case "plan":
        this.appendPlan(message.delta);
        break;
      case "plan_update":
        this.replacePlan(message);
        break;
      case "tool_output":
        this.appendToolOutput(message);
        break;
      case "progress":
        this.applyProgress(message);
        break;
      case "notification":
        this.applyNotification(message);
        break;
      case "turn_summary":
        this.applyTurnSummary(message);
        break;
      default:
        break;
    }
  }

  applyTurnSummary(summary: Partial<IMTurnSummary>): void {
    this.setTokenUsage(summary.tokenUsage);
    if (summary.lastAgentMessage && !this.content) {
      this.content = summary.lastAgentMessage;
    }
  }

  derivedMessage(): string | undefined {
    return this.content || undefined;
  }

  snapshot(): TurnStateSnapshot {
    return {
      threadId: this.threadId,
      turnId: this.turnId,
      threadName: this.threadName,
      promptSummary: this.promptSummary,
      backendName: this.backendName,
      modelName: this.modelName,
      turnMode: this.turnMode,
      content: this.content,
      reasoning: this.reasoning,
      planDraft: this.planDraft,
      plan: this.plan,
      planExplanation: this.planExplanation,
      tools: this.tools.map((tool) => ({ ...tool })),
      toolOutputs: [...this.toolOutputs.values()].map((chunk) => ({ ...chunk })),
      tokenUsage: this.tokenUsage,
      duration: Math.max(0, this.now() - this.startedAt),
    };
  }

  toSummary(): IMTurnSummary {
    const snapshot = this.snapshot();
    return {
      kind: "turn_summary",
      threadId: snapshot.threadId,
      threadName: snapshot.threadName,
      turnId: snapshot.turnId,
      filesChanged: [],
      tokenUsage: snapshot.tokenUsage,
      duration: snapshot.duration,
      lastAgentMessage: this.derivedMessage(),
    };
  }
}
