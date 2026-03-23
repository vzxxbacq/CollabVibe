/**
 * @module services/turn/types
 *
 * Turn 数据类型 — 定义权在 contracts 层。
 *
 * 本文件是 TurnRecord、TurnDetailRecord 及其子类型的唯一定义来源。
 * L1 通过 OrchestratorApi 获取这些类型的实例（getTurnDetail, getTurnCardData, listTurns 等），
 * L2 import 此类型用于内部实现和持久化。
 *
 * 所有 Turn 数据的读写操作必须通过 core-api.md §2-§3 定义的 API 方法。
 *
 * @see docs/01-architecture/core-api.md §2 Turn 生命周期
 * @see docs/01-architecture/core-api.md §3 Turn 数据查询与更新
 */

import type { IMProgressEvent } from "../event/im-output";

// ── Turn 核心类型 ────────────────────────────────────────────────────────────

export type TurnStatus =
  | "running"
  | "awaiting_approval"
  | "completed"
  | "accepted"
  | "reverted"
  | "interrupted"
  | "failed";

export interface TurnTokenUsage {
  input: number;
  output: number;
  total?: number;
}

export interface TurnRecord {
  projectId: string;
  threadName: string;
  threadId: string;
  turnId: string;
  callId?: string;
  platform?: string;
  sourceMessageId?: string;
  userId?: string;
  traceId?: string;
  status: TurnStatus;
  cwd: string;
  snapshotSha?: string;
  filesChanged?: string[];
  diffSummary?: string;
  stats?: { additions: number; deletions: number };
  approvalRequired: boolean;
  approvalResolvedAt?: string;
  lastAgentMessage?: string;
  tokenUsage?: TurnTokenUsage;
  /** 线程内的人类可读顺序编号 */
  turnNumber?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ── Turn Detail 类型 ─────────────────────────────────────────────────────────

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
