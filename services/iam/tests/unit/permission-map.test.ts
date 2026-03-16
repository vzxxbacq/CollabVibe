import { describe, expect, it } from "vitest";

import { hasPermission, RolePermissionMap } from "../../src/index";
import type { Permission, EffectiveRole } from "../../src/permissions";

describe("RolePermissionMap", () => {
  const ALL_PERMISSIONS: Permission[] = [
    "system.admin",
    "project.read",
    "thread.manage",
    "thread.merge",
    "turn.operate",
    "skill.use",
    "skill.manage",
    "approval.decide",
    "config.write",
    "help.read"
  ];

  it("admin has ALL permissions", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission("admin", permission)).toBe(true);
    }
  });

  it("maintainer has all permissions except system.admin", () => {
    const adminOnly = new Set(RolePermissionMap.admin);
    const maintainerSet = new Set(RolePermissionMap.maintainer);
    for (const p of adminOnly) {
      if (p === "system.admin") {
        expect(maintainerSet.has(p)).toBe(false);
      } else {
        expect(maintainerSet.has(p)).toBe(true);
      }
    }
  });

  it("developer has no thread.merge, skill.manage, or approval.decide", () => {
    expect(hasPermission("developer", "thread.merge")).toBe(false);
    expect(hasPermission("developer", "skill.manage")).toBe(false);
    expect(hasPermission("developer", "approval.decide")).toBe(false);
    expect(hasPermission("developer", "system.admin")).toBe(false);
  });

  it("developer has thread.manage, turn.operate, project.read, help.read, skill.use, config.write", () => {
    expect(hasPermission("developer", "thread.manage")).toBe(true);
    expect(hasPermission("developer", "turn.operate")).toBe(true);
    expect(hasPermission("developer", "project.read")).toBe(true);
    expect(hasPermission("developer", "help.read")).toBe(true);
    expect(hasPermission("developer", "skill.use")).toBe(true);
    expect(hasPermission("developer", "config.write")).toBe(true);
  });

  it("auditor has ONLY help.read", () => {
    const auditorPermissions = new Set(RolePermissionMap.auditor);
    expect(auditorPermissions.size).toBe(1);
    expect(auditorPermissions.has("help.read")).toBe(true);
  });

  it.each<[EffectiveRole, Permission, boolean]>([
    // ── admin: everything ──
    ["admin", "system.admin", true],
    ["admin", "project.read", true],
    ["admin", "thread.manage", true],
    ["admin", "thread.merge", true],
    ["admin", "turn.operate", true],
    ["admin", "skill.use", true],
    ["admin", "skill.manage", true],
    ["admin", "approval.decide", true],
    ["admin", "config.write", true],
    ["admin", "help.read", true],
    // ── maintainer: all except system.admin ──
    ["maintainer", "system.admin", false],
    ["maintainer", "project.read", true],
    ["maintainer", "thread.manage", true],
    ["maintainer", "thread.merge", true],
    ["maintainer", "turn.operate", true],
    ["maintainer", "skill.use", true],
    ["maintainer", "skill.manage", true],
    ["maintainer", "approval.decide", true],
    ["maintainer", "config.write", true],
    ["maintainer", "help.read", true],
    // ── developer: no merge, no skill.manage, no approval, no system.admin ──
    ["developer", "system.admin", false],
    ["developer", "project.read", true],
    ["developer", "thread.manage", true],
    ["developer", "thread.merge", false],
    ["developer", "turn.operate", true],
    ["developer", "skill.use", true],
    ["developer", "skill.manage", false],
    ["developer", "approval.decide", false],
    ["developer", "config.write", true],
    ["developer", "help.read", true],
    // ── auditor: only help.read ──
    ["auditor", "system.admin", false],
    ["auditor", "project.read", false],
    ["auditor", "thread.manage", false],
    ["auditor", "thread.merge", false],
    ["auditor", "turn.operate", false],
    ["auditor", "skill.use", false],
    ["auditor", "skill.manage", false],
    ["auditor", "approval.decide", false],
    ["auditor", "config.write", false],
    ["auditor", "help.read", true],
  ])("hasPermission(%s, %s) === %s", (role, permission, expected) => {
    expect(hasPermission(role, permission)).toBe(expected);
  });
});
