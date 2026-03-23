/**
 * @module services/types/iam
 *
 * IAM 角色类型 — 定义权在 contracts 层。
 *
 * 本文件是 ProjectRole / EffectiveRole 的唯一定义来源。
 * L1 通过 OrchestratorApi 的 resolveRole / listProjectMembers 等方法获取角色信息，
 * L2 import 此类型用于鉴权和成员管理。
 *
 * Permission 枚举和 RolePermissionMap 映射是 L2 内部实现，不在此定义。
 *
 * @see docs/01-architecture/core-api.md §7 IAM 与用户管理
 */

/** 项目级角色 — 持久化在 adminState.members[projectId] 中 */
export type ProjectRole = "maintainer" | "developer" | "auditor";

/**
 * 有效角色 — authorizeIntent 使用的解析后角色。
 * "admin" 由 UserRepository.isAdmin() 派生，不作为 ProjectRole 持久化。
 */
export type EffectiveRole = "admin" | ProjectRole;
