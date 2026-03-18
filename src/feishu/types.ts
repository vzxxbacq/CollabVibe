/**
 * @module src/feishu/types
 * @layer Feishu (platform-specific)
 *
 * Defines `FeishuHandlerDeps` — the dependency interface for Feishu-specific handlers.
 *
 * ## Responsibilities
 * - Extend `CoreDeps` with Feishu-local ports:
 *   `feishuAdapter`, `platformOutput`, `recentMessageIds`, `messageDedupTtlMs`, `projectSetupService`
 * - Keep Feishu rendering/output method tables local to the Feishu layer
 *
 * ## Import Constraints
 * ✅ May import: src/core/, packages/channel-feishu, services/*
 * ❌ Must NOT import: src/slack/, channel-slack
 *
 * ## Consumers
 * - `src/feishu/feishu-message-handler.ts` — all functions accept FeishuHandlerDeps
 * - `src/feishu/feishu-card-handler.ts` — all functions accept FeishuHandlerDeps
 * - `src/feishu/shared-handlers.ts` — rendering functions accept FeishuHandlerDeps
 * - `src/server.ts` — constructs the FeishuHandlerDeps object
 */
import type { CoreDeps } from "../../services/orchestrator/src/handler-types";
import type { FeishuAdapter, FeishuOutputAdapter } from "./channel/index";
import type { ProjectSetupServiceLike } from "../handlers/types";
import type { AuditService } from "../../services/orchestrator/src/audit/index";

export type FeishuAdapterPort = Pick<
  FeishuAdapter,
  "sendMessage" | "sendInteractiveCard" | "updateInteractiveCard" | "getUserDisplayName" | "pinMessage" | "listChatMembers" | "leaveChat" | "downloadMessageFile"
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
  projectSetupService: ProjectSetupServiceLike;
  /** 操作审计服务 — 记录命令和卡片操作 */
  auditService?: AuditService;
}
