import type { TurnDetailRecord, TurnRecord, TurnTokenUsage } from "./types";

export interface TurnListItem {
  projectId: string;
  turnId: string;
  threadId: string;
  threadName: string;
  turnNumber?: number;
  status: TurnRecord["status"];
  promptSummary?: string;
  lastAgentMessage?: string;
  backendName?: string;
  modelName?: string;
  filesChangedCount: number;
  tokenUsage?: TurnTokenUsage;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TurnDetailAggregate {
  record: TurnRecord;
  detail: TurnDetailRecord;
}

export interface RecordTurnStartInput {
  projectId: string;
  threadName: string;
  threadId: string;
  turnId: string;
  callId?: string;
  platform?: string;
  sourceMessageId?: string;
  cwd: string;
  userId?: string;
  traceId?: string;
}

export interface EnsureTurnStartInput extends RecordTurnStartInput {
  promptSummary?: string;
  backendName?: string;
  modelName?: string;
  turnMode?: "plan";
}

export interface TurnMetadataPatch {
  promptSummary?: string;
  backendName?: string;
  modelName?: string;
  turnMode?: "plan";
}

export interface TurnSummaryPatch {
  lastAgentMessage?: string;
  tokenUsage?: { input: number; output: number; total?: number };
  filesChanged?: string[];
}
