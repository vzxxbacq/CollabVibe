/**
 * @module src/feishu/types
 * @layer Feishu (platform-specific)
 *
 * Defines `FeishuHandlerDeps` — the dependency interface for Feishu-specific handlers.
 *
 * ## Import Constraints
 * ✅ May import: src/handlers/types, services/contracts.ts
 * ❌ Must NOT import: services/** internal modules, src/slack/
 */
import type { CoreDeps } from "../common/types";
import type { FeishuAdapter, FeishuOutputAdapter } from "./channel/index";

export type FeishuAdapterPort = Pick<
  FeishuAdapter,
  "sendMessage" | "sendInteractiveCard" | "updateInteractiveCard" | "getUserDisplayName" | "getCachedUserDisplayName" | "pinMessage" | "listChatMembers" | "leaveChat" | "downloadMessageFile"
>;


/**
 * FeishuHandlerDeps — 飞书专属 handler 依赖。
 *
 * extends CoreDeps（平台无关）+ 飞书专属字段。
 */
export interface FeishuHandlerDeps extends CoreDeps {
  feishuAdapter: FeishuAdapterPort;
  platformOutput: FeishuOutputAdapter;
  recentMessageIds: Set<string>;
  messageDedupTtlMs: number;
}
