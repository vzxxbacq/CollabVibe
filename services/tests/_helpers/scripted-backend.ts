import type { UnifiedAgentEvent } from "../../../packages/agent-core/src/index";

export type BackendScriptStep =
  | { type: "event"; event: UnifiedAgentEvent }
  | { type: "sleep"; ms: number }
  | { type: "wait_approval"; approvalId: string }
  | { type: "wait_user_input"; callId: string };

export function firstScriptTurnId(script: BackendScriptStep[]): string | undefined {
  for (const step of script) {
    if (step.type === "event" && "turnId" in step.event && typeof step.event.turnId === "string") {
      return step.event.turnId;
    }
  }
  return undefined;
}
