import { describe, expect, it } from "vitest";

import { hasPermission, RolePermissionMap } from "../src/index";

describe("role permission map", () => {
  const allPermissions = [
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
  ] as const;

  it("platform_admin has all permissions", () => {
    for (const permission of allPermissions) {
      expect(hasPermission("platform_admin", permission)).toBe(true);
    }
  });

  it("project_owner permission set matches platform_admin", () => {
    expect(new Set(RolePermissionMap.project_owner)).toEqual(new Set(RolePermissionMap.platform_admin));
  });

  it("developer cannot create project", () => {
    expect(hasPermission("developer", "project.create")).toBe(false);
  });

  it("approver has only project/audit read plus approval decision", () => {
    const approverPermissions = new Set(RolePermissionMap.approver);
    expect(approverPermissions).toEqual(new Set(["project.read", "audit.read", "approval.decide"]));
  });

  it("auditor can only read project and audit", () => {
    const auditorPermissions = new Set(RolePermissionMap.auditor);
    expect(auditorPermissions).toEqual(new Set(["project.read", "audit.read"]));
  });

  it.each([
    ["platform_admin", "project.create", true],
    ["platform_admin", "project.read", true],
    ["platform_admin", "thread.new", true],
    ["platform_admin", "thread.resume", true],
    ["platform_admin", "turn.start", true],
    ["platform_admin", "turn.interrupt", true],
    ["platform_admin", "skill.install", true],
    ["platform_admin", "skill.list", true],
    ["platform_admin", "audit.read", true],
    ["platform_admin", "approval.decide", true],
    ["platform_admin", "config.write", true],
    ["project_owner", "project.create", true],
    ["project_owner", "project.read", true],
    ["project_owner", "thread.new", true],
    ["project_owner", "thread.resume", true],
    ["project_owner", "turn.start", true],
    ["project_owner", "turn.interrupt", true],
    ["project_owner", "skill.install", true],
    ["project_owner", "skill.list", true],
    ["project_owner", "audit.read", true],
    ["project_owner", "approval.decide", true],
    ["project_owner", "config.write", true],
    ["developer", "project.create", false],
    ["developer", "project.read", true],
    ["developer", "thread.new", true],
    ["developer", "thread.resume", true],
    ["developer", "turn.start", true],
    ["developer", "turn.interrupt", true],
    ["developer", "skill.install", false],
    ["developer", "skill.list", true],
    ["developer", "audit.read", false],
    ["developer", "approval.decide", false],
    ["developer", "config.write", false],
    ["approver", "project.create", false],
    ["approver", "project.read", true],
    ["approver", "thread.new", false],
    ["approver", "thread.resume", false],
    ["approver", "turn.start", false],
    ["approver", "turn.interrupt", false],
    ["approver", "skill.install", false],
    ["approver", "skill.list", false],
    ["approver", "audit.read", true],
    ["approver", "approval.decide", true],
    ["approver", "config.write", false],
    ["auditor", "project.create", false],
    ["auditor", "project.read", true],
    ["auditor", "thread.new", false],
    ["auditor", "thread.resume", false],
    ["auditor", "turn.start", false],
    ["auditor", "turn.interrupt", false],
    ["auditor", "skill.install", false],
    ["auditor", "skill.list", false],
    ["auditor", "audit.read", true],
    ["auditor", "approval.decide", false],
    ["auditor", "config.write", false]
  ] as const)("permission matrix %s -> %s = %s", (role, permission, expected) => {
    expect(hasPermission(role, permission)).toBe(expected);
  });

  it("rejects unknown role gracefully", () => {
    expect(hasPermission("hacker" as any, "project.create")).toBe(false);
  });
});
