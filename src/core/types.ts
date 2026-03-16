/**
 * @module src/core/types
 * @layer Core (platform-agnostic)
 *
 * Defines `CoreDeps` — the dependency interface for all platform-agnostic business logic.
 *
 * ## Responsibilities
 * - Declare the minimal set of services needed by `intent-dispatcher` and `platform-commands`
 * - Act as the "supertype" for platform-specific deps (e.g. `FeishuHandlerDeps extends CoreDeps`)
 *
 * ## Import Constraints
 * ✅ May import: packages/*, services/*, src/handlers/types (for *Like aliases — temporary)
 * ❌ Must NOT import: src/feishu/, src/slack/, channel-feishu, channel-slack
 *
 * ## Consumers
 * - `src/core/intent-dispatcher.ts` — uses CoreDeps for orchestrator calls
 * - `src/core/platform-commands.ts` — uses CoreDeps for business logic
 * - `src/feishu/types.ts` — extends CoreDeps with Feishu-specific fields
 */
import type { AppConfig } from "../config";
import type {
  OrchestratorLike, PluginServiceLike,
  ApprovalHandlerLike,
  AdminStateStoreLike
} from "../handlers/types";
import type { ProjectConfig } from "../../services/admin-api/src/contracts";
import type { RoleResolver } from "../../services/iam/src/role-resolver";
import type { UserRepository } from "../../packages/channel-core/src/user-repository";

/**
 * CoreDeps — platform-agnostic shared dependencies.
 *
 * Contains orchestrator (the sole gateway to thread/backend state), skill, admin, and other core services.
 * Does NOT contain any IM-platform-specific dependencies (Feishu API, card builders, etc.).
 * Does NOT expose internal orchestrator services — all access goes through orchestrator facade.
 */
export interface CoreDeps {
  config: AppConfig;
  orchestrator: OrchestratorLike;
  pluginService: PluginServiceLike;
  approvalHandler: ApprovalHandlerLike;
  adminStateStore: AdminStateStoreLike;
  findProjectByChatId(chatId: string): ProjectConfig | null;
  userRepository: UserRepository;
  roleResolver: RoleResolver;
}

