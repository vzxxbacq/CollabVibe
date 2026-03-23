/**
 * TurnCardDataProvider — L2 → L1 bridge for card state recovery.
 *
 * When L1 needs to reconstruct a card after server restart (e.g. for Accept/Revert),
 * it queries L2 via this interface instead of maintaining a redundant JSON blob.
 *
 * @layer contracts (L2 boundary)
 */
import type { TurnToolCall, TurnToolOutput, TurnPlanState, TurnMode } from "../src/types/turn";
import type { TurnStatus, TurnTokenUsage } from "../src/types/turn";

export interface TurnCardData {
  chatId: string;
  turnId: string;
  threadName: string;
  turnNumber?: number;
  backendName?: string;
  modelName?: string;
  message?: string;
  reasoning?: string;
  turnMode?: TurnMode;
  tools: TurnToolCall[];
  toolOutputs: TurnToolOutput[];
  planState?: TurnPlanState;
  promptSummary?: string;
  agentNote?: string;
  fileChanges: Array<{
    filesChanged: string[];
    diffSummary: string;
    stats?: { additions: number; deletions: number };
  }>;
  tokenUsage?: TurnTokenUsage;
  status: TurnStatus;
}

export interface TurnCardDataProvider {
  getTurnCardData(chatId: string, turnId: string): Promise<TurnCardData | null>;
}
