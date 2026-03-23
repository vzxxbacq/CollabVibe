import type { AdminStateStore } from "../project/admin-state";
import type { MemberRecord, ProjectRole } from "../project/project-types";
import type { UserRepository } from "./user-repository";
import { RoleResolver } from "./role-resolver";

export class IamService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly adminStateStore: AdminStateStore,
    private readonly roleResolver: RoleResolver,
  ) {}

  resolveRole(input: { userId: string; projectId?: string }): "admin" | "maintainer" | "developer" | "auditor" | null {
    return this.roleResolver.resolve(input.userId, input.projectId, { autoRegister: true });
  }

  isAdmin(userId: string): boolean {
    return this.roleResolver.isAdmin(userId);
  }

  addAdmin(targetUserId: string): void {
    this.userRepo.setAdmin(targetUserId, "im");
  }

  removeAdmin(targetUserId: string): { ok: boolean; reason?: string } {
    return this.userRepo.removeAdmin(targetUserId);
  }

  listAdmins(): Array<{ userId: string; source: "env" | "im" }> {
    return this.userRepo.listAdmins().map((entry) => ({ userId: entry.userId, source: entry.source }));
  }

  addProjectMember(input: { projectId: string; userId: string; role: ProjectRole }): void {
    this.userRepo.ensureUser(input.userId);
    const state = this.adminStateStore.read();
    const members = state.members[input.projectId] ?? [];
    if (!members.some((member) => member.userId === input.userId)) {
      members.push({ userId: input.userId, role: input.role });
      state.members[input.projectId] = members;
      this.adminStateStore.write(state);
    }
  }

  removeProjectMember(input: { projectId: string; userId: string }): void {
    const state = this.adminStateStore.read();
    state.members[input.projectId] = (state.members[input.projectId] ?? []).filter(
      (member) => member.userId !== input.userId
    );
    this.adminStateStore.write(state);
  }

  updateProjectMemberRole(input: { projectId: string; userId: string; role: ProjectRole }): void {
    const state = this.adminStateStore.read();
    const members = state.members[input.projectId] ?? [];
    const nextMembers: MemberRecord[] = members.map((member) =>
      member.userId === input.userId ? { ...member, role: input.role } : member
    );
    state.members[input.projectId] = nextMembers;
    this.adminStateStore.write(state);
  }

  listProjectMembers(projectId: string): MemberRecord[] {
    return this.adminStateStore.read().members[projectId] ?? [];
  }

  listUsers(input?: { offset?: number; limit?: number; userIds?: string[] }): { users: Array<{ userId: string; sysRole: string; source: string }>; total: number } {
    const result = this.userRepo.listAll(input);
    return {
      users: result.users.map((user) => ({
        userId: user.userId,
        sysRole: user.sysRole === 1 ? "admin" : "user",
        source: user.source,
      })),
      total: result.total,
    };
  }
}
