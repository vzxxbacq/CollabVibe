/**
 * @module services/thread/types
 *
 * Thread 数据类型 — 定义权在 contracts 层。
 *
 * 本文件是 ThreadRecord 的唯一定义来源（single source of truth）。
 * L1（src/feishu, src/slack）通过 OrchestratorApi 获取 ThreadRecord 实例，
 * L2（services/orchestrator）import 此类型用于内部实现。
 *
 * L1 可以 import 此类型用于类型标注，但不能绕过 OrchestratorApi 直接构造或修改。
 * 所有 ThreadRecord 的读写操作必须通过 core-api.md 定义的 API 方法。
 *
 * @see docs/01-architecture/core-api.md §1 Thread 管理
 */

import type { BackendIdentity } from "../../packages/agent-core/src/index";
import type { ThreadExecutionPolicyOverride } from "./thread-execution-policy-types";

/**
 * ThreadRecord — 项目级、创建后核心字段不可变的线程元数据。
 *
 * 不变式：
 *   - 线程绑定到项目（project），不绑定到用户
 *   - 后端身份（backendId, model, transport）在创建后不可修改（I4）
 *   - threadId 是后端分配的不透明句柄（Codex thread UUID 或 ACP session ID）
 */
export interface ThreadRecord {
  projectId?: string;
  threadName: string;
  /** 后端分配的不透明句柄（Codex thread UUID 或 ACP session ID） */
  threadId: string;
  /** 后端身份 — 创建后不可修改 */
  backend: BackendIdentity;
  /** worktree 创建时 workBranch 的 HEAD commit SHA */
  baseSha?: string;
  /** 是否有 turn 产生了 commit（finishTurn 后设为 true） */
  hasDiverged?: boolean;
  /** worktree 绝对路径 */
  worktreePath?: string;
  /** Thread-level execution policy override (Phase 1: sandbox/approvalPolicy) */
  executionPolicyOverride?: ThreadExecutionPolicyOverride;
}
