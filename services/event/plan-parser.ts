type PlanStatus = "pending" | "in_progress" | "completed";

export interface FinalPlanState {
  explanation?: string;
  items: Array<{ step: string; status: PlanStatus }>;
}

export function normalizePlanStatus(line: string): PlanStatus {
  const value = line.trim().toLowerCase();
  if (/^\[(x|done)\]/i.test(value) || /(已完成|完成|done|completed)$/.test(value)) {
    return "completed";
  }
  if (/^\[(~|>|-)\]/.test(value) || /(进行中|处理中|in progress|ongoing)$/.test(value)) {
    return "in_progress";
  }
  return "pending";
}

export function extractMarkdownHeading(line: string): string | null {
  const match = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line);
  return match ? match[1]!.trim() : null;
}

export function stripPlanStepPrefix(line: string): string {
  return line
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/^\s*\[(?: |x|X|done|~|>)\]\s*/i, "")
    .replace(/^\s*第[一二三四五六七八九十\d]+步[:：.、]?\s*/, "")
    .trim();
}

export function looksLikePlanStep(line: string): boolean {
  return /^\s*(?:[-*+•]|\d+[.)]|\[(?: |x|X|done|~|>)\]|第[一二三四五六七八九十\d]+步)/.test(line);
}

export function parsePlanDraft(raw: string): FinalPlanState | null {
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
    const heading = extractMarkdownHeading(line);
    if (heading) {
      if (!seenStep) {
        explanationLines.push(heading);
      } else {
        currentSection = heading;
      }
      continue;
    }
    if (looksLikePlanStep(line)) {
      seenStep = true;
      const step = stripPlanStepPrefix(line);
      if (step) {
        items.push({
          step: currentSection ? `${currentSection}｜${step}` : step,
          status: normalizePlanStatus(line)
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
