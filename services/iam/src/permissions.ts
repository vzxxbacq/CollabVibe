export type Role = "platform_admin" | "project_owner" | "developer" | "approver" | "auditor";

export type Permission =
  | "project.create"
  | "project.read"
  | "thread.new"
  | "thread.resume"
  | "turn.start"
  | "turn.interrupt"
  | "skill.install"
  | "skill.list"
  | "audit.read"
  | "approval.decide"
  | "config.write";

export const RolePermissionMap: Record<Role, Permission[]> = {
  platform_admin: [
    "project.create",
    "project.read",
    "thread.new",
    "thread.resume",
    "turn.start",
    "turn.interrupt",
    "skill.install",
    "skill.list",
    "audit.read",
    "approval.decide",
    "config.write"
  ],
  project_owner: [
    "project.create",
    "project.read",
    "thread.new",
    "thread.resume",
    "turn.start",
    "turn.interrupt",
    "skill.install",
    "skill.list",
    "audit.read",
    "approval.decide",
    "config.write"
  ],
  developer: ["project.read", "thread.new", "thread.resume", "turn.start", "turn.interrupt", "skill.list"],
  approver: ["project.read", "audit.read", "approval.decide"],
  auditor: ["audit.read", "project.read"]
};
