/**
 * @module services/contracts/src/index
 *
 * Barrel export for OrchestratorApi — L1 最小可见集。
 *
 * L2 内部类型（ApiGuardConfig, Permission, OutputGateway, IMError, IMMergeEvent）
 * 由 L2 直接 import orchestrator-api.ts，不通过此 barrel 暴露。
 */
export type {
  OrchestratorApi,
  OrchestratorLayer,
  TurnInputItem,
  MergeContext,
  MergeResult,
  TurnCardData,
} from "./orchestrator-api";

export { AuthorizationError } from "./orchestrator-api";
