import type { IMProgressEvent } from "../../../contracts/im/im-output";

export type TurnMode = "plan";

export interface TurnPlanState {
  explanation?: string;
  items: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
}

export interface TurnToolCall {
  label: string;
  tool: IMProgressEvent["tool"];
  callId?: string;
  status: "running" | "completed" | "failed";
  targetFile?: string;
  exitCode?: number;
  duration?: string;
  summary?: string;
}

export interface TurnToolOutput {
  callId: string;
  command: string;
  output: string;
}

export interface TurnDetailRecord {
  projectId: string;
  turnId: string;
  promptSummary?: string;
  backendName?: string;
  modelName?: string;
  turnMode?: TurnMode;
  message?: string;
  reasoning?: string;
  tools: TurnToolCall[];
  toolOutputs: TurnToolOutput[];
  planState?: TurnPlanState;
  agentNote?: string;
  createdAt: string;
  updatedAt: string;
}

