import type { ProjectRole } from "../types/iam";
export type { ProjectRole } from "../types/iam";

// ─────────────────────────────────────────────────────────────────────────────
// Project Domain Types — L2 核心业务模型
// ─────────────────────────────────────────────────────────────────────────────
//
// 定义 Project 领域的值对象类型。被 orchestrator、IAM、persistence、
// turn/thread services 等多个 L2 模块使用。
//
// 语义拆分自原 admin-state.ts（2026-03-22）。
// ─────────────────────────────────────────────────────────────────────────────

/** 项目聚合根持久记录 — 唯一持久源 */
export interface ProjectRecord {
  id: string;
  name: string;
  chatId: string;
  cwd: string;
  defaultBranch: string;
  workBranch: string;
  enabledSkills?: string[];
  gitUrl?: string;
  sandbox: string;
  approvalPolicy: string;
  status: "active" | "disabled";
  createdAt?: string;
  updatedAt?: string;
}

/** 项目成员记录 */
export interface MemberRecord {
  userId: string;
  role: ProjectRole;
}
