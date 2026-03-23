import type { IMOutputMessage } from "../event/im-output";
import type { FinalPlanState } from "./plan-parser";

export function buildPlanUpdateMessage(turnId: string, plan: FinalPlanState): IMOutputMessage {
  return {
    kind: "plan_update",
    turnId,
    explanation: plan.explanation,
    plan: plan.items
  };
}
