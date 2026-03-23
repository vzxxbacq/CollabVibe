import { hasPermission } from "./iam/authorize";
import type { Permission } from "./iam/permissions";
import { AuthorizationError, type ApiGuardConfig, type OrchestratorApi } from "./orchestrator-api";
import { AuditService } from "./audit/audit-service";
import { RoleResolver } from "./iam/role-resolver";

const API_GUARDS: Partial<Record<keyof OrchestratorApi, ApiGuardConfig>> = {
  createProject: { permission: "config.write", requiresProject: false, audit: true, auditAction: "project.create" },
  linkProjectToChat: { permission: "config.write", requiresProject: false, audit: true, auditAction: "project.link" },
  unlinkProject: { permission: "config.write", requiresProject: true, audit: true, auditAction: "project.unlink" },
  disableProject: { permission: "config.write", requiresProject: true, audit: true, auditAction: "project.disable" },
  reactivateProject: { permission: "config.write", requiresProject: true, audit: true, auditAction: "project.reactivate" },
  deleteProject: { permission: "system.admin", requiresProject: true, audit: true, auditAction: "project.delete" },
  updateGitRemote: { permission: "config.write", requiresProject: true, audit: true, auditAction: "project.updateGitRemote" },
  updateProjectConfig: { permission: "config.write", requiresProject: true, audit: true, auditAction: "project.updateConfig" },
  createThread: { permission: "thread.manage", requiresProject: true, audit: true, auditAction: "thread.create" },
  joinThread: { permission: "thread.manage", requiresProject: true, audit: true, auditAction: "thread.join" },
  leaveThread: { permission: "thread.manage", requiresProject: true, audit: true, auditAction: "thread.leave" },
  deleteThread: { permission: "thread.manage", requiresProject: true, audit: true, auditAction: "thread.delete" },
  createTurn: { permission: "turn.operate", requiresProject: true, audit: true, auditAction: "turn.create" },
  interruptTurn: { permission: "turn.operate", requiresProject: true, audit: true, auditAction: "turn.interrupt" },
  acceptTurn: { permission: "turn.operate", requiresProject: true, audit: true, auditAction: "turn.accept" },
  revertTurn: { permission: "turn.operate", requiresProject: true, audit: true, auditAction: "turn.revert" },
  handleMerge: { permission: "thread.merge", requiresProject: true, audit: true, auditAction: "merge.execute" },
  handleMergeConfirm: { permission: "thread.merge", requiresProject: true, audit: true, auditAction: "merge.confirm" },
  startMergeReview: { permission: "thread.merge", requiresProject: true, audit: true, auditAction: "merge.review.start" },
  commitMergeReview: { permission: "thread.merge", requiresProject: true, audit: true, auditAction: "merge.commit" },
  cancelMergeReview: { permission: "thread.merge", requiresProject: true, audit: true, auditAction: "merge.cancel" },
  resolveConflictsViaAgent: { permission: "thread.merge", requiresProject: true, audit: true, auditAction: "merge.agentResolve" },
  pushWorkBranch: { permission: "thread.merge", requiresProject: true, audit: true, auditAction: "branch.push" },
  updateBackendPolicy: { permission: "system.admin", requiresProject: false, audit: true, auditAction: "backend.updatePolicy" },
  adminAddProvider: { permission: "system.admin", requiresProject: false, audit: true, auditAction: "backend.addProvider" },
  adminRemoveProvider: { permission: "system.admin", requiresProject: false, audit: true, auditAction: "backend.removeProvider" },
  adminAddModel: { permission: "system.admin", requiresProject: false, audit: true, auditAction: "backend.addModel" },
  adminRemoveModel: { permission: "system.admin", requiresProject: false, audit: true, auditAction: "backend.removeModel" },
  adminTriggerRecheck: { permission: "system.admin", requiresProject: false, audit: true, auditAction: "backend.recheck" },
  adminWriteProfile: { permission: "system.admin", requiresProject: false, audit: true, auditAction: "backend.writeProfile" },
  adminDeleteProfile: { permission: "system.admin", requiresProject: false, audit: true, auditAction: "backend.deleteProfile" },
  addProjectMember: { permission: "config.write", requiresProject: true, audit: true, auditAction: "member.add" },
  removeProjectMember: { permission: "config.write", requiresProject: true, audit: true, auditAction: "member.remove" },
  updateProjectMemberRole: { permission: "config.write", requiresProject: true, audit: true, auditAction: "member.updateRole" },
  installSkill: { permission: "skill.manage", requiresProject: true, audit: true, auditAction: "skill.install" },
  removeSkill: { permission: "skill.manage", requiresProject: true, audit: true, auditAction: "skill.remove" },
  bindSkillToProject: { permission: "skill.manage", requiresProject: true, audit: true, auditAction: "skill.bind" },
  unbindSkillFromProject: { permission: "skill.manage", requiresProject: true, audit: true, auditAction: "skill.unbind" },
  installFromGithub: { permission: "skill.manage", requiresProject: false, audit: true, auditAction: "skill.installGithub" },
  installFromLocalSource: { permission: "skill.manage", requiresProject: false, audit: true, auditAction: "skill.installLocal" },
  handleApprovalCallback: { permission: null, requiresProject: false, audit: true, auditAction: "approval.callback" },
  toggleProjectStatus: { permission: "config.write", requiresProject: true, audit: true, auditAction: "project.toggleStatus" },
  validateSkillNameCandidate: { permission: null, requiresProject: false, audit: false },
  listSkillCatalog: { permission: null, requiresProject: false, audit: false },
  // §1 Thread — supplemented
  listThreads: { permission: "project.read", requiresProject: true, audit: false },
  getBackendCatalog: { permission: "project.read", requiresProject: true, audit: false },
  // §5 Merge — supplemented
  mergeDecideFile: { permission: "thread.merge", requiresProject: true, audit: false },
  mergeAcceptAll: { permission: "thread.merge", requiresProject: true, audit: false },
  retryMergeFile: { permission: "thread.merge", requiresProject: true, audit: false },
  retryMergeFiles: { permission: "thread.merge", requiresProject: true, audit: false },
  // §7 IAM — supplemented
  listAdmins: { permission: null, requiresProject: false, audit: false },
};

function extractActorId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const candidate = (input as Record<string, unknown>).actorId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function extractProjectId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const candidate = (input as Record<string, unknown>).projectId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function resolveRoleForGuard(roleResolver: RoleResolver, userId: string, projectId?: string) {
  return roleResolver.resolve(userId, projectId);
}

export function withApiGuards(
  rawApi: OrchestratorApi,
  roleResolver: RoleResolver,
  auditService: AuditService,
): OrchestratorApi {
  return new Proxy(rawApi, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof original !== "function") {
        return original;
      }
      const guard = API_GUARDS[prop as keyof OrchestratorApi];
      if (!guard) {
        return original;
      }

      return (...args: unknown[]) => {
        const input = args[0];
        const actorId = extractActorId(input);
        const projectId = extractProjectId(input);
        const requiredPermission: Permission | null = guard.permission;

        if (actorId && requiredPermission) {
          const role = resolveRoleForGuard(roleResolver, actorId, projectId);
          if (!hasPermission(role, requiredPermission)) {
            throw new AuthorizationError(actorId, requiredPermission);
          }
        }

        const appendAudit = (result: "ok" | "denied" | "error") => {
          if (guard.audit && guard.auditAction && actorId) {
            void auditService.append({
              projectId: projectId ?? "system",
              actorId,
              action: guard.auditAction,
              result,
            });
          }
        };

        try {
          const result = original.apply(target, args);
          if (result && typeof result === "object" && "then" in result) {
            return (result as Promise<unknown>)
              .then((value) => {
                appendAudit("ok");
                return value;
              })
              .catch((error) => {
                appendAudit(error instanceof AuthorizationError ? "denied" : "error");
                throw error;
              });
          }
          appendAudit("ok");
          return result;
        } catch (error) {
          appendAudit(error instanceof AuthorizationError ? "denied" : "error");
          throw error;
        }
      };
    },
  });
}
