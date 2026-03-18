import { RolePermissionMap, type EffectiveRole, type Permission } from "./permissions";

export class AuthorizationError extends Error {
  readonly status = 403;

  readonly code = "FORBIDDEN";
}

export function hasPermission(role: EffectiveRole, permission: Permission): boolean {
  const permissions = RolePermissionMap[role];
  if (!permissions) {
    return false;
  }
  return permissions.includes(permission);
}

export function authorize(role: EffectiveRole | null | undefined, permission: Permission): void {
  if (!role || !hasPermission(role, permission)) {
    throw new AuthorizationError(`role cannot perform ${permission}`);
  }
}
