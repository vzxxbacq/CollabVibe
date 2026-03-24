// ─────────────────────────────────────────────────────────────────────────────
// AdminStateStore — L2 管理状态持久化接口
// ─────────────────────────────────────────────────────────────────────────────
//
// 定义 admin 持久化层的聚合状态和存储接口。
// 被 SqliteAdminStateStore (persistence/) 实现，由 project-service、iam-service 消费。
//
// 语义拆分（2026-03-22）：
//   ProjectRole, ProjectRecord, MemberRecord → project-types.ts
//   OrchestratorConfig                       → orchestrator-config.ts
//   AdminPersistedState, AdminStateStore     → 本文件
// ─────────────────────────────────────────────────────────────────────────────

import type { ProjectRecord, MemberRecord } from "./project-types";

export interface AdminPersistedState {
  wizardStep: Record<string, number>;
  projects: ProjectRecord[];
  members: Record<string, MemberRecord[]>;
}

export interface AdminStateStore {
  read(): Promise<AdminPersistedState>;
  write(state: AdminPersistedState): Promise<void>;
}

