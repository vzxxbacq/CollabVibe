import type { IMOutputMessage } from "../event/im-output";
import { buildPlanUpdateMessage } from "./plan-output";
import { parsePlanDraft, type FinalPlanState } from "./plan-parser";

interface PlanTurnState {
  readonly turnId: string;
  readonly mode: "plan";
  draft: string;
  structured?: FinalPlanState;
}

interface PlanRouteBinding {
  projectId: string;
  turnId: string;
  turnMode?: "plan";
}

function turnKey(projectId: string, turnId: string): string {
  return `${projectId}:${turnId}`;
}

export class PlanTurnFinalizer {
  private readonly states = new Map<string, PlanTurnState>();

  registerRoute(route: PlanRouteBinding): void {
    if (route.turnMode !== "plan") {
      return;
    }
    this.states.set(turnKey(route.projectId, route.turnId), {
      turnId: route.turnId,
      mode: "plan",
      draft: ""
    });
  }

  unregister(projectId: string, turnId: string): void {
    this.states.delete(turnKey(projectId, turnId));
  }

  ingestMessage(projectId: string, message: IMOutputMessage): void {
    if (!("turnId" in message) || !message.turnId) {
      return;
    }
    const state = this.states.get(turnKey(projectId, message.turnId));
    if (!state) {
      return;
    }
    if (message.kind === "plan") {
      state.draft += message.delta;
      return;
    }
    if (message.kind === "plan_update") {
      state.structured = {
        explanation: message.explanation,
        items: message.plan.filter((item) => item.step.trim().length > 0)
      };
    }
  }

  finalize(projectId: string, turnId: string): { message?: IMOutputMessage; error?: string } {
    const state = this.states.get(turnKey(projectId, turnId));
    if (!state) {
      return {};
    }
    if (state.structured && (state.structured.items.length > 0 || state.structured.explanation)) {
      return { message: buildPlanUpdateMessage(turnId, state.structured) };
    }
    const parsed = parsePlanDraft(state.draft);
    if (!parsed) {
      return { error: "plan turn completed without structured plan or draft content" };
    }
    state.structured = parsed;
    return { message: buildPlanUpdateMessage(turnId, parsed) };
  }

}
