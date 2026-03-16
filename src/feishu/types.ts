/**
 * @module src/feishu/types
 * @layer Feishu (platform-specific)
 *
 * Defines `FeishuHandlerDeps` — the dependency interface for Feishu-specific handlers.
 *
 * ## Responsibilities
 * - Extend `CoreDeps` with 5 Feishu-specific fields:
 *   `feishuAdapter`, `feishuOutputAdapter`, `recentMessageIds`, `messageDedupTtlMs`, `projectSetupService`
 * - Re-export `*Like` type aliases for convenience
 *
 * ## Import Constraints
 * ✅ May import: src/core/, src/handlers/types (for *Like aliases — temporary)
 * ❌ Must NOT import: src/slack/, channel-slack
 *
 * ## Consumers
 * - `src/feishu/feishu-message-handler.ts` — all functions accept FeishuHandlerDeps
 * - `src/feishu/feishu-card-handler.ts` — all functions accept FeishuHandlerDeps
 * - `src/feishu/shared-handlers.ts` — rendering functions accept FeishuHandlerDeps
 * - `src/server.ts` — constructs the FeishuHandlerDeps object
 */
import type { CoreDeps } from "../core/types";
import type {
  FeishuAdapterLike, FeishuOutputAdapterLike, ProjectSetupServiceLike
} from "../handlers/types";
import type { AuditService } from "../../services/audit/src/audit-service";

/**
 * FeishuHandlerDeps — 飞书专属 handler 依赖。
 *
 * extends CoreDeps（平台无关）+ 飞书专属字段。
 */
export interface FeishuHandlerDeps extends CoreDeps {
  feishuAdapter: FeishuAdapterLike;
  feishuOutputAdapter: FeishuOutputAdapterLike;
  recentMessageIds: Set<string>;
  messageDedupTtlMs: number;
  projectSetupService: ProjectSetupServiceLike;
  /** 操作审计服务 — 记录命令和卡片操作 */
  auditService?: AuditService;
}
