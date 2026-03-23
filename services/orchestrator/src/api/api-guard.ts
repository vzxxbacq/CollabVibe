/**
 * @module services/orchestrator/src/api/api-guard
 *
 * API Guard 拦截层 — L2 API 的第一道防线。
 *
 * 每个 OrchestratorApi 方法通过 Proxy 自动执行鉴权和审计。
 * L1 不感知此层的存在，只需 catch AuthorizationError。
 *
 * 实现方式：ES Proxy `get` 拦截器，查 API_GUARDS 表，执行权限验证 + 审计写入。
 */

import type { OrchestratorApi } from "../../../contracts/src/orchestrator-api";
import {
  Permission,
  AuthorizationError,
  type ApiGuardConfig,
} from "../../../contracts/src/orchestrator-api";
import type { AuditService } from "../audit/audit-service";

// ── Auth Service interface ───────────────────────────────────────────────────

/**
 * L2 内部鉴权服务接口。
 * 由 IamService 实现，Guard 以组合方式注入。
 */
export interface AuthService {
  /** 判断用户是否拥有指定权限。不满足时抛 AuthorizationError。 */
  authorize(userId: string | undefined, projectId: string | undefined, permission: string): void;
}

// ── Audit Log Writer ─────────────────────────────────────────────────────────

/**
 * 审计日志写入接口。
 * Guard 在每次 API 调用后写入审计记录：actorId, action, result (ok | denied | error)。
 */
export interface AuditLogWriter {
  append(entry: {
    projectId: string;
    actorId: string;
    action: string;
    result: "ok" | "denied" | "error";
  }): void;
}

/**
 * AuditService → AuditLogWriter 适配器。
 * 将 Guard 的 append 调用转为异步 AuditService.append，fire-and-forget。
 */
export class AuditServiceLogWriter implements AuditLogWriter {
  constructor(private readonly auditService: AuditService) { }

  append(entry: {
    projectId: string;
    actorId: string;
    action: string;
    result: "ok" | "denied" | "error";
  }): void {
    // Fire-and-forget: guard 不等待审计写入完成
    this.auditService.append({
      projectId: entry.projectId,
      actorId: entry.actorId,
      action: entry.action,
      result: entry.result,
    }).catch(() => {
      // Non-critical path — 审计写入失败不影响 API 调用
    });
  }
}

// ── API Guards table ─────────────────────────────────────────────────────────

/** 完整 API Guard 配置表 — 严格匹配 core-api.md。 */
export const API_GUARDS: Record<string, ApiGuardConfig> = {
  // §0 项目与绑定
  resolveProjectId: { permission: null, requiresProject: false, audit: false },
  getProjectRecord: { permission: null, requiresProject: false, audit: false },
  createProject: { permission: Permission.PROJECT_WRITE, requiresProject: false, audit: true, auditAction: "project.create" },
  linkProjectToChat: { permission: Permission.PROJECT_WRITE, requiresProject: false, audit: true, auditAction: "project.link" },
  unlinkProject: { permission: Permission.PROJECT_WRITE, requiresProject: true, audit: true, auditAction: "project.unlink" },
  disableProject: { permission: Permission.PROJECT_WRITE, requiresProject: true, audit: true, auditAction: "project.disable" },
  reactivateProject: { permission: Permission.PROJECT_WRITE, requiresProject: true, audit: true, auditAction: "project.reactivate" },
  deleteProject: { permission: Permission.ADMIN, requiresProject: true, audit: true, auditAction: "project.delete" },
  listProjects: { permission: null, requiresProject: false, audit: false },
  listUnboundProjects: { permission: Permission.ADMIN, requiresProject: false, audit: false },
  updateGitRemote: { permission: Permission.PROJECT_WRITE, requiresProject: true, audit: true, auditAction: "project.updateGitRemote" },
  updateProjectConfig: { permission: Permission.PROJECT_WRITE, requiresProject: true, audit: true, auditAction: "project.updateConfig" },

  // §1 Thread
  createThread: { permission: Permission.THREAD_WRITE, requiresProject: true, audit: true, auditAction: "thread.create" },
  joinThread: { permission: Permission.THREAD_WRITE, requiresProject: true, audit: true, auditAction: "thread.join" },
  leaveThread: { permission: Permission.THREAD_WRITE, requiresProject: true, audit: true, auditAction: "thread.leave" },
  deleteThread: { permission: Permission.THREAD_WRITE, requiresProject: true, audit: true, auditAction: "thread.delete" },
  listThreads: { permission: Permission.THREAD_READ, requiresProject: true, audit: false },
  getUserActiveThread: { permission: null, requiresProject: true, audit: false },
  getThreadRecord: { permission: null, requiresProject: true, audit: false },
  isPendingApproval: { permission: null, requiresProject: true, audit: false },

  // §2 Turn (Path B internal methods removed: recordTurnStart → see TODO-20)
  createTurn: { permission: Permission.TURN_WRITE, requiresProject: true, audit: true, auditAction: "turn.create" },
  interruptTurn: { permission: Permission.TURN_WRITE, requiresProject: true, audit: true, auditAction: "turn.interrupt" },
  acceptTurn: { permission: Permission.TURN_WRITE, requiresProject: true, audit: true, auditAction: "turn.accept" },
  revertTurn: { permission: Permission.TURN_WRITE, requiresProject: true, audit: true, auditAction: "turn.revert" },
  respondUserInput: { permission: Permission.TURN_WRITE, requiresProject: true, audit: false },

  // §3 Turn 数据 (Path B internal methods removed: updateTurnSummary, updateTurnMetadata, appendTurnEvent, syncTurnState, finalizeTurnState → see TODO-20)
  getTurnDetail: { permission: null, requiresProject: true, audit: false },
  getTurnCardData: { permission: null, requiresProject: true, audit: false },
  listTurns: { permission: null, requiresProject: true, audit: false },

  // §4 Snapshot (Path B internal method removed: updateSnapshotSummary → see TODO-20)
  listSnapshots: { permission: null, requiresProject: true, audit: false },
  jumpToSnapshot: { permission: Permission.TURN_WRITE, requiresProject: true, audit: true, auditAction: "snapshot.jump" },
  getSnapshotDiff: { permission: null, requiresProject: true, audit: false },

  // §5 Merge
  handleMerge: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: true, auditAction: "merge.execute" },
  handleMergePreview: { permission: null, requiresProject: true, audit: false },
  handleMergeConfirm: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: true, auditAction: "merge.confirm" },
  handleMergeReject: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: false },
  handleMergeWithConflictResolver: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: true, auditAction: "merge.resolve" },
  startMergeReview: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: true, auditAction: "merge.review.start" },
  getMergeReview: { permission: null, requiresProject: true, audit: false },
  mergeDecideFile: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: false },
  mergeAcceptAll: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: false },
  commitMergeReview: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: true, auditAction: "merge.commit" },
  cancelMergeReview: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: true, auditAction: "merge.cancel" },
  configureMergeResolver: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: false },
  resolveConflictsViaAgent: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: true, auditAction: "merge.agentResolve" },
  retryMergeFile: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: false },
  retryMergeFiles: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: false },
  pushWorkBranch: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: true, auditAction: "branch.push" },
  detectStaleThreads: { permission: null, requiresProject: true, audit: false },

  // §6 Backend 管理
  listAvailableBackends: { permission: null, requiresProject: false, audit: false },
  listModelsForBackend: { permission: null, requiresProject: false, audit: false },
  resolveBackend: { permission: null, requiresProject: true, audit: false },
  resolveSession: { permission: null, requiresProject: true, audit: false },
  readBackendConfigs: { permission: null, requiresProject: false, audit: false },
  readBackendPolicy: { permission: null, requiresProject: false, audit: false },
  updateBackendPolicy: { permission: Permission.ADMIN, requiresProject: false, audit: true, auditAction: "backend.updatePolicy" },
  adminAddProvider: { permission: Permission.ADMIN, requiresProject: false, audit: true, auditAction: "backend.addProvider" },
  adminRemoveProvider: { permission: Permission.ADMIN, requiresProject: false, audit: true, auditAction: "backend.removeProvider" },
  adminAddModel: { permission: Permission.ADMIN, requiresProject: false, audit: true, auditAction: "backend.addModel" },
  adminRemoveModel: { permission: Permission.ADMIN, requiresProject: false, audit: true, auditAction: "backend.removeModel" },
  adminTriggerRecheck: { permission: Permission.ADMIN, requiresProject: false, audit: true, auditAction: "backend.recheck" },
  adminWriteProfile: { permission: Permission.ADMIN, requiresProject: false, audit: true, auditAction: "backend.writeProfile" },
  adminDeleteProfile: { permission: Permission.ADMIN, requiresProject: false, audit: true, auditAction: "backend.deleteProfile" },
  checkBackendHealth: { permission: null, requiresProject: false, audit: false },

  // §7 IAM
  resolveRole: { permission: null, requiresProject: false, audit: false },
  isAdmin: { permission: null, requiresProject: false, audit: false },
  addAdmin: { permission: Permission.ADMIN, requiresProject: false, audit: true, auditAction: "admin.add" },
  removeAdmin: { permission: Permission.ADMIN, requiresProject: false, audit: true, auditAction: "admin.remove" },
  listAdmins: { permission: null, requiresProject: false, audit: false },
  addProjectMember: { permission: Permission.PROJECT_WRITE, requiresProject: true, audit: true, auditAction: "member.add" },
  removeProjectMember: { permission: Permission.PROJECT_WRITE, requiresProject: true, audit: true, auditAction: "member.remove" },
  updateProjectMemberRole: { permission: Permission.PROJECT_WRITE, requiresProject: true, audit: true, auditAction: "member.updateRole" },
  listProjectMembers: { permission: null, requiresProject: true, audit: false },
  listUsers: { permission: Permission.ADMIN, requiresProject: false, audit: false },

  // §8 Skill
  listSkills: { permission: null, requiresProject: false, audit: false },
  listProjectSkills: { permission: null, requiresProject: true, audit: false },
  installSkill: { permission: Permission.SKILL_WRITE, requiresProject: true, audit: true, auditAction: "skill.install" },
  removeSkill: { permission: Permission.SKILL_WRITE, requiresProject: true, audit: true, auditAction: "skill.remove" },
  bindSkillToProject: { permission: Permission.SKILL_WRITE, requiresProject: true, audit: true, auditAction: "skill.bind" },
  unbindSkillFromProject: { permission: Permission.SKILL_WRITE, requiresProject: true, audit: true, auditAction: "skill.unbind" },
  installFromGithub: { permission: Permission.SKILL_WRITE, requiresProject: false, audit: true, auditAction: "skill.installGithub" },
  installFromLocalSource: { permission: Permission.SKILL_WRITE, requiresProject: false, audit: true, auditAction: "skill.installLocal" },
  inspectLocalSource: { permission: null, requiresProject: false, audit: false },
  allocateStagingDir: { permission: null, requiresProject: false, audit: false },

  // §9 审批
  handleApprovalCallback: { permission: null, requiresProject: false, audit: true, auditAction: "approval.callback" },
};

// ── withApiGuards ────────────────────────────────────────────────────────────

/**
 * 包装原始 API 实例，自动拦截每个方法调用以执行鉴权和审计。
 *
 * @param rawApi       - 原始 OrchestratorApi 实例（无鉴权）
 * @param authService  - 鉴权服务（isAdmin + authorize）
 * @param auditLog     - 审计日志写入器
 * @returns 带鉴权和审计的 OrchestratorApi 实例
 */
export function withApiGuards(
  rawApi: OrchestratorApi,
  authService: AuthService,
  auditLog: AuditLogWriter,
): OrchestratorApi {
  return new Proxy(rawApi, {
    get(target, prop: string) {
      const original = (target as unknown as Record<string, unknown>)[prop];
      if (typeof original !== "function") return original;

      const guard = API_GUARDS[prop];
      if (!guard) return original;

      return (...args: unknown[]) => {
        // Extract userId / projectId from first input arg (convention: input objects)
        const input = (args[0] != null && typeof args[0] === "object")
          ? args[0] as { userId?: string; projectId?: string }
          : { userId: undefined, projectId: undefined };

        // Permission check
        if (guard.permission) {
          authService.authorize(input.userId, input.projectId, guard.permission);
        }

        let auditResult: "ok" | "denied" | "error" = "ok";
        try {
          const result = (original as Function).apply(target, args);

          // Handle both sync and async methods
          if (result instanceof Promise) {
            return result.catch((err: unknown) => {
              auditResult = err instanceof AuthorizationError ? "denied" : "error";
              throw err;
            }).finally(() => {
              if (guard.audit && guard.auditAction) {
                auditLog.append({
                  projectId: input.projectId ?? "",
                  actorId: input.userId ?? "",
                  action: guard.auditAction!,
                  result: auditResult,
                });
              }
            });
          }

          // Sync method — audit inline
          if (guard.audit && guard.auditAction) {
            auditLog.append({
              projectId: input.projectId ?? "",
              actorId: input.userId ?? "",
              action: guard.auditAction,
              result: auditResult,
            });
          }
          return result;
        } catch (err) {
          auditResult = err instanceof AuthorizationError ? "denied" : "error";
          if (guard.audit && guard.auditAction) {
            auditLog.append({
              projectId: input.projectId ?? "",
              actorId: input.userId ?? "",
              action: guard.auditAction,
              result: auditResult,
            });
          }
          throw err;
        }
      };
    },
  }) as OrchestratorApi;
}
