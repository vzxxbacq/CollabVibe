import { RolePermissionMap, type EffectiveRole, type Permission } from "./permissions";
import { AuthorizationError } from "../orchestrator-api";

export function hasPermission(role: EffectiveRole, permission: Permission): boolean {
  const permissions = RolePermissionMap[role];
  if (!permissions) {
    return false;
  }
  return permissions.includes(permission);
}

export function authorize(role: EffectiveRole | null | undefined, permission: Permission): void {
  if (!role || !hasPermission(role, permission)) {
    throw new AuthorizationError("unknown", permission, `role cannot perform ${permission}`);
  }
}
