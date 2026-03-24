// ─────────────────────────────────────────────────────────────────────────────
// ProjectResolver — L2 DI 接口：chatId → projectId 解引用
// ─────────────────────────────────────────────────────────────────────────────
//
// AGENTS.md P3 规则：所有从 IM 层进入 orchestrator 的 chat 事件，
// 先通过 ProjectResolver.findProjectByChatId(chatId) 获取 projectId，
// 再访问线程/历史数据。
//
// 纯接口文件：无运行时代码，0% 覆盖率是预期的。
// 实现方：ProjectService (services/project/project-service.ts)
// ─────────────────────────────────────────────────────────────────────────────

import type { ProjectRecord } from "./project-types";

export interface ProjectResolver {
  findProjectByChatId(chatId: string): Promise<ProjectRecord | null>;
  findProjectById?(projectId: string): Promise<ProjectRecord | null>;
  listActiveProjects?(): Promise<ProjectRecord[]>;
}
