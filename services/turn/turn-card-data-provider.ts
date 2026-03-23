/**
 * TurnCardDataProvider — L2 → L1 bridge for card state recovery.
 *
 * When L1 needs to reconstruct a card after server restart (e.g. for Accept/Revert),
 * it queries L2 via this interface instead of maintaining a redundant JSON blob.
 *
 * @layer contracts (L2 boundary)
 */
import type { TurnToolCall, TurnToolOutput, TurnPlanState, TurnMode } from "./types";
import type { TurnStatus, TurnTokenUsage } from "./types";
import type { DiffFileSummary, DiffFileSegment } from "../../packages/git-utils/src/index";

export interface TurnCardData {
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
    /** Pre-parsed per-file summaries (L2 computed from git-utils) */
    diffFiles: DiffFileSummary[];
    /** Pre-parsed per-file diff segments with content (L2 computed from git-utils) */
    diffSegments: DiffFileSegment[];
  }>;
  tokenUsage?: TurnTokenUsage;
  status: TurnStatus;
  /** Whether this turn belongs to a merge-resolver thread (L2 pre-computed) */
  isMergeResolver: boolean;
}

export interface TurnCardDataProvider {
  getTurnCardData(projectId: string, turnId: string): Promise<TurnCardData | null>;
}
