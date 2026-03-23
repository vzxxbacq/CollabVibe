import type { SessionRecoveryFailureCategory } from "./session-recovery-service";

export function classifyRecoveryFailure(error: unknown): {
  category: SessionRecoveryFailureCategory;
  reason: string;
} {
  const reason = error instanceof Error ? error.message : String(error);
  const tagged = /^([A-Z_]+):\s*(.*)$/.exec(reason);
  if (!tagged) {
    return { category: "UNKNOWN", reason };
  }
  const category = tagged[1] as SessionRecoveryFailureCategory;
  const known = new Set<SessionRecoveryFailureCategory>([
    "CONFIG_ERROR",
    "BACKEND_SESSION_MISSING",
    "WORKTREE_MISSING",
    "SKILL_SYNC_FAILED",
    "UNKNOWN",
  ]);
  return known.has(category)
    ? { category, reason: tagged[2] || reason }
    : { category: "UNKNOWN", reason };
}
