/**
 * @module src/core/intent-dispatcher
 * @layer Core (platform-agnostic)
 *
 * Shared intent dispatch chain: classify → authorize → route → orchestrator.
 *
 * ## Responsibilities
 * - `classifyIntent(message)` — wraps `routeIntent` for message → ParsedIntent classification
 * - `dispatchIntent(deps, params, intent)` — the shared pipeline:
 *   1. `authorizeIntent(role, intent)` — permission check
 *   2. `shouldRouteToAgent(intent, messageType)` — agent vs non-agent routing
 *   3. `orchestrator.handleIntent(...)` — execute agent commands
 * - Returns `IntentDispatchResult` discriminated union:
 *   - `{ routed: true, result }` — agent command executed, result ready for rendering
 *   - `{ routed: false, intent }` — non-agent command, platform layer handles rendering
 *
 * ## Import Constraints
 * ✅ May import: packages/channel-core, services/iam, services/orchestrator, src/core/types
 * ❌ Must NOT import: src/feishu/, channel-feishu
 *
 * ## Consumers
 * - `src/feishu/feishu-message-handler.ts` — calls dispatchIntent after preflight guards
 */
import { routeIntent, shouldRouteToAgent } from "../../../contracts/im/intent-router";
import { authorizeIntent } from "../iam/index";
import type { HandleIntentResult } from "../index";
import type { ParsedIntent } from "../../../contracts/im/types";
import type { EffectiveRole } from "../iam/index";
import type { CoreDeps } from "../handler-types";

/**
 * IntentDispatchResult — dispatchIntent 的返回值。
 *
 * routed=true:  agent 命令，已由 orchestrator 处理，result 包含 HandleIntentResult
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

/**
 * dispatchIntent — 共享的 intent 分发链路。
 *
 * 1. authorizeIntent(role, intent) — 权限检查
 * 2. shouldRouteToAgent(intent, messageType) — 分流判断
 * 3. orchestrator.handleIntent(...) — agent 命令执行
 *
 * 平台层调用此函数后，根据 routed 决定后续行为：
 * - routed=true: 使用 result 渲染 agent 结果
 * - routed=false: 调用 platform-commands 处理非 agent 命令
 */
export async function dispatchIntent(
  deps: CoreDeps, params: IntentParams, intent: ParsedIntent
): Promise<IntentDispatchResult> {
  authorizeIntent(params.role, intent.intent);

  if (!shouldRouteToAgent(intent.intent, params.messageType)) {
    return { routed: false, intent };
  }

  const result = await deps.orchestrator.handleIntent(
    params.projectId, params.chatId, intent,
    params.text, params.traceId, params.userId
  );
  return { routed: true, result };
}
