import type { IntentType } from "../../../packages/channel-core/src/types";
import { authorize } from "./authorize";
import type { Permission, Role } from "./permissions";

export const IntentPermissionMap: Partial<Record<IntentType, Permission>> = {
  PROJECT_CREATE: "project.create",
  PROJECT_LIST: "project.read",
  THREAD_NEW: "thread.new",
  THREAD_RESUME: "thread.resume",
  SKILL_INSTALL: "skill.install",
  SKILL_LIST: "skill.list",
  TURN_INTERRUPT: "turn.interrupt",
  TURN_START: "turn.start"
};

export function authorizeIntent(role: Role | null | undefined, intent: IntentType): void {
  const permission = IntentPermissionMap[intent];
  if (!permission) {
    return;
  }
  authorize(role, permission);
}
