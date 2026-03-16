import type { IMTurnSummary } from "./im-output";

export class TurnContext {
  private readonly startedAt: number;

  private tokenUsage: { input: number; output: number; total?: number } | undefined;

  private lastAgentMessage: string | undefined;

  constructor(
    private readonly threadId: string,
    private readonly turnId: string,
    private readonly threadName?: string,
    private readonly now: () => number = () => Date.now()
  ) {
    this.startedAt = this.now();
  }

  setTokenUsage(tokenUsage: { input: number; output: number; total?: number } | undefined): void {
    this.tokenUsage = tokenUsage;
  }

  setLastAgentMessage(message: string | undefined): void {
    this.lastAgentMessage = message;
  }

  toSummary(): IMTurnSummary {
    return {
      kind: "turn_summary",
      threadId: this.threadId,
      threadName: this.threadName,
      turnId: this.turnId,
      filesChanged: [],
      tokenUsage: this.tokenUsage,
      duration: Math.max(0, this.now() - this.startedAt),
      lastAgentMessage: this.lastAgentMessage
    };
  }
}
