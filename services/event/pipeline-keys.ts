import type { UnifiedAgentEvent } from "../../packages/agent-core/src/index";
import type { ThreadRouteBinding } from "./pipeline";

export function contextKey(projectId: string, turnId: string): string {
  return `${projectId}:${turnId}`;
}

export function threadKey(route: ThreadRouteBinding): string {
  return `${route.projectId}:${route.threadName}`;
}

export function activeTurnKey(route: ThreadRouteBinding, turnId: string): string {
  return `${threadKey(route)}:${turnId}`;
}

export function turnIdFromEvent(event: UnifiedAgentEvent): string | null {
  return event.turnId && event.turnId.length > 0 ? event.turnId : null;
}
