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

  async resolveRole(input: { userId: string; projectId?: string }): Promise<"admin" | "maintainer" | "developer" | "auditor" | null> {
    return this.roleResolver.resolve(input.userId, input.projectId, { autoRegister: true });
  }

  async isAdmin(userId: string): Promise<boolean> {
    return this.roleResolver.isAdmin(userId);
  }

  async addAdmin(targetUserId: string): Promise<void> {
    await this.userRepo.setAdmin(targetUserId, "im");
  }

  async removeAdmin(targetUserId: string): Promise<{ ok: boolean; reason?: string }> {
    return await this.userRepo.removeAdmin(targetUserId);
  }

  async listAdmins(): Promise<Array<{ userId: string; source: "env" | "im" }>> {
    const admins = await this.userRepo.listAdmins();
    return admins.map((entry) => ({ userId: entry.userId, source: entry.source }));
  }

  async addProjectMember(input: { projectId: string; userId: string; role: ProjectRole }): Promise<void> {
    await this.userRepo.ensureUser(input.userId);
    const state = await this.adminStateStore.read();
    const members = state.members[input.projectId] ?? [];
    if (!members.some((member) => member.userId === input.userId)) {
      members.push({ userId: input.userId, role: input.role });
      state.members[input.projectId] = members;
      await this.adminStateStore.write(state);
    }
  }

  async removeProjectMember(input: { projectId: string; userId: string }): Promise<void> {
    const state = await this.adminStateStore.read();
    state.members[input.projectId] = (state.members[input.projectId] ?? []).filter(
      (member) => member.userId !== input.userId
    );
    await this.adminStateStore.write(state);
  }

  async updateProjectMemberRole(input: { projectId: string; userId: string; role: ProjectRole }): Promise<void> {
    const state = await this.adminStateStore.read();
    const members = state.members[input.projectId] ?? [];
    const nextMembers: MemberRecord[] = members.map((member) =>
      member.userId === input.userId ? { ...member, role: input.role } : member
    );
    state.members[input.projectId] = nextMembers;
    await this.adminStateStore.write(state);
  }

  async listProjectMembers(projectId: string): Promise<MemberRecord[]> {
    return (await this.adminStateStore.read()).members[projectId] ?? [];
  }

  async listUsers(input?: { offset?: number; limit?: number; userIds?: string[] }): Promise<{ users: Array<{ userId: string; sysRole: string; source: string }>; total: number }> {
    const result = await this.userRepo.listAll(input);
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
