/**
 * @module src/platform/dispatcher
 * @layer L1 (platform-agnostic shared)
 *
 * Shared intent dispatch chain: classify → authorize → route → OrchestratorApi.
 *
 * ## Import Constraints (L1)
 * ✅ May import: services/contracts.ts (core-api types), src/platform/ (L1 shared)
 * ❌ Must NOT import: services/orchestrator/ (L2 internals)
 */
import { routeIntent, shouldRouteToAgent } from "./intent-router";
import { authorizeIntent } from "./command-guard";
import type { ParsedIntent } from "./intent-types";
import type { EffectiveRole } from "../../services/index";
import type { OrchestratorApi } from "../../services/index";
import type { HandleIntentResult } from "./result";
import { ResultMode } from "./result";

/**
 * IntentDispatchResult — dispatchIntent 的返回值。
 *
 * routed=true:  agent 命令，已由 OrchestratorApi 处理，result 包含 HandleIntentResult
 * routed=false: 非 agent 命令，intent 原样返回给平台层处理
 */
export type IntentDispatchResult =
  | { routed: true; result: HandleIntentResult }
  | { routed: false; intent: ParsedIntent };

export interface IntentParams {
  projectId: string;
  chatId: string;
  userId: string;
  text: string;
  traceId?: string;
  platform: "feishu" | "slack";
  messageId?: string;
  messageType: "command" | "text";
  role: EffectiveRole;
}

/**
 * classifyIntent — 对消息进行 intent 分类。
 * 纯函数，与平台无关。
 */
export function classifyIntent(message: Parameters<typeof routeIntent>[0]): ParsedIntent {
  return routeIntent(message);
}

/** dispatcher 只需 OrchestratorApi 的部分方法 */
interface DispatchDeps {
  api: Pick<OrchestratorApi,
    | "createTurn" | "pushWorkBranch" | "detectStaleThreads"
    | "deleteThread" | "getUserActiveThread"
  >;
}

/**
 * dispatchIntent — 共享的 intent 分发链路。
 *
 * 1. authorizeIntent(role, intent) — 权限检查
 * 2. shouldRouteToAgent(intent, messageType) — 分流判断
 * 3. 调用 OrchestratorApi 对应方法
 */
export async function dispatchIntent(
  deps: DispatchDeps, params: IntentParams, intent: ParsedIntent
): Promise<IntentDispatchResult> {
  authorizeIntent(params.role, intent.intent);

  if (!shouldRouteToAgent(intent.intent, params.messageType)) {
    return { routed: false, intent };
  }

  const result = await executeAgentIntent(deps, params);
  return { routed: true, result };
}

/**
 * executeAgentIntent — 将 TURN_START 类 intent 分解为 OrchestratorApi 调用。
 * 替代原 ConversationOrchestrator.handleIntent() monolith 方法。
 */
async function executeAgentIntent(
  deps: DispatchDeps, params: IntentParams
): Promise<HandleIntentResult> {
  const { api } = deps;
  const { projectId, userId, text, traceId, platform, messageId } = params;

  // /push — push workBranch to remote
  const pushMatch = /^\s*\/push(?:\s|$)/.exec(text);
  if (pushMatch) {
    try {
      await api.pushWorkBranch({ projectId: projectId, actorId: userId });
      return { mode: ResultMode.THREAD_SYNC_TEXT, id: "push", text: "✅ workBranch 已推送到远程。" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { mode: ResultMode.THREAD_SYNC_TEXT, id: "push", text: `❌ 推送失败: ${msg}` };
    }
  }

  // /sync — report stale threads in this project
  const syncMatch = /^\s*\/sync(?:\s|$)/.exec(text);
  if (syncMatch && !/^\s*\/sync-reset/.test(text)) {
    const binding = await api.getUserActiveThread({ projectId, userId });
    const mergedThreadName = binding?.threadName ?? "__unknown__";
    const report = await api.detectStaleThreads({ projectId, mergedThreadName });
    const lines: string[] = [];
    if (report.updated.length > 0) {
      lines.push(`✅ 自动更新 ${report.updated.length} 个线程:`);
      for (const u of report.updated) lines.push(`  • ${u.threadName}: ${u.oldSha.slice(0, 7)} → ${u.newSha.slice(0, 7)}`);
    }
    if (report.stale.length > 0) {
      lines.push(`⚠️ ${report.stale.length} 个线程需要手动同步 (/sync-reset):`);
      for (const s of report.stale) lines.push(`  • ${s.threadName} (base: ${s.baseSha.slice(0, 7)}, HEAD: ${s.workBranchHead.slice(0, 7)})`);
    }
    if (report.errors.length > 0) {
      lines.push(`❌ ${report.errors.length} 个线程处理失败:`);
      for (const e of report.errors) lines.push(`  • ${e.threadName}: ${e.error}`);
    }
    if (lines.length === 0) lines.push("✅ 所有线程已是最新状态。");
    return { mode: ResultMode.THREAD_SYNC_TEXT, id: "sync", text: lines.join("\n") };
  }

  // /sync-reset {threadName} — rebuild worktree from latest workBranch
  const syncResetMatch = /^\s*\/sync-reset\s+(\S+)/.exec(text);
  if (syncResetMatch) {
    const targetThreadName = syncResetMatch[1]!;
    try {
      await api.deleteThread({ projectId, threadName: targetThreadName, actorId: userId });
      return { mode: ResultMode.THREAD_SYNC_TEXT, id: "sync-reset", text: `✅ 线程 \`${targetThreadName}\` 已重置。请使用 /thread join 重新加入。` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { mode: ResultMode.THREAD_SYNC_TEXT, id: "sync-reset", text: `❌ 重置线程 \`${targetThreadName}\` 失败: ${msg}` };
    }
  }

  // /plan — plan mode turn
  const planMatch = /^\s*\/plan(?:\s+|$)/.exec(text);
  const mode = planMatch ? ("plan" as const) : undefined;
  const normalizedText = planMatch ? text.slice(planMatch[0].length).trim() || "请先给出执行计划。" : text;

  const result = await api.createTurn({ projectId, userId, actorId: userId,
    text: normalizedText,
    traceId,
    mode,
    platform,
    messageId,
  });
  return { mode: ResultMode.TURN, id: result.turnId, duplicate: result.status === "duplicate" };
}
