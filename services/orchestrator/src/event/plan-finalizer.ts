import type { IMOutputMessage } from "../../../../packages/channel-core/src/im-output";

type PlanStatus = "pending" | "in_progress" | "completed";

interface FinalPlanState {
  explanation?: string;
  items: Array<{ step: string; status: PlanStatus }>;
}

interface PlanTurnState {
  readonly turnId: string;
  readonly mode: "plan";
  draft: string;
  structured?: FinalPlanState;
}

interface PlanRouteBinding {
  chatId: string;
  turnId: string;
  turnMode?: "plan";
}

function turnKey(chatId: string, turnId: string): string {
  return `${chatId}:${turnId}`;
}

function normalizeStatus(line: string): PlanStatus {
  const value = line.trim().toLowerCase();
  if (/^\[(x|done)\]/i.test(value) || /(已完成|完成|done|completed)$/.test(value)) {
    return "completed";
  }
  if (/^\[(~|>|-)\]/.test(value) || /(进行中|处理中|in progress|ongoing)$/.test(value)) {
    return "in_progress";
  }
  return "pending";
}

function extractHeading(line: string): string | null {
  const match = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line);
  return match ? match[1]!.trim() : null;
}

function stripStepPrefix(line: string): string {
  return line
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/^\s*\[(?: |x|X|done|~|>)\]\s*/i, "")
    .replace(/^\s*第[一二三四五六七八九十\d]+步[:：.、]?\s*/, "")
    .trim();
}

function looksLikeStep(line: string): boolean {
  return /^\s*(?:[-*+•]|\d+[.)]|\[(?: |x|X|done|~|>)\]|第[一二三四五六七八九十\d]+步)/.test(line);
}

function parseDraftPlan(raw: string): FinalPlanState | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const items: Array<{ step: string; status: PlanStatus }> = [];
  const explanationLines: string[] = [];
  let seenStep = false;
  let currentSection: string | undefined;

  for (const line of lines) {
    const heading = extractHeading(line);
    if (heading) {
      if (!seenStep) {
        explanationLines.push(heading);
      } else {
        currentSection = heading;
      }
      continue;
    }
    if (looksLikeStep(line)) {
      seenStep = true;
      const step = stripStepPrefix(line);
      if (step) {
        items.push({
          step: currentSection ? `${currentSection}｜${step}` : step,
          status: normalizeStatus(line)
        });
      }
      continue;
    }
    if (!seenStep) {
      explanationLines.push(line.trim());
      continue;
    }
    if (items.length > 0) {
      const last = items[items.length - 1];
      last.step = `${last.step} ${line.trim()}`.trim();
    } else {
      explanationLines.push(line.trim());
    }
  }

  if (items.length === 0) {
    const explanation = lines.join("\n").trim();
    return explanation
      ? { explanation, items: [{ step: explanation, status: "pending" }] }
      : null;
  }

  return {
    explanation: explanationLines.join("\n").trim() || undefined,
    items
  };
}

function planUpdateMessage(turnId: string, plan: FinalPlanState): IMOutputMessage {
  return {
    kind: "plan_update",
    turnId,
    explanation: plan.explanation,
    plan: plan.items
  };
}

export class PlanTurnFinalizer {
  private readonly states = new Map<string, PlanTurnState>();

  registerRoute(route: PlanRouteBinding): void {
    if (route.turnMode !== "plan") {
      return;
    }
    this.states.set(turnKey(route.chatId, route.turnId), {
      turnId: route.turnId,
      mode: "plan",
      draft: ""
    });
  }

  unregister(chatId: string, turnId: string): void {
    this.states.delete(turnKey(chatId, turnId));
  }

  ingestMessage(chatId: string, message: IMOutputMessage): void {
    if (!("turnId" in message) || !message.turnId) {
      return;
    }
    const state = this.states.get(turnKey(chatId, message.turnId));
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

  finalize(chatId: string, turnId: string): { message?: IMOutputMessage; error?: string } {
    const state = this.states.get(turnKey(chatId, turnId));
    if (!state) {
      return {};
    }
    if (state.structured && (state.structured.items.length > 0 || state.structured.explanation)) {
      return { message: planUpdateMessage(turnId, state.structured) };
    }
    const parsed = parseDraftPlan(state.draft);
    if (!parsed) {
      return { error: "plan turn completed without structured plan or draft content" };
    }
    state.structured = parsed;
    return { message: planUpdateMessage(turnId, parsed) };
  }

}
