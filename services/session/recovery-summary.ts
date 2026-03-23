import type { SessionRecoveryResult } from "./session-recovery-service";

export function createEmptyRecoverySummary(): SessionRecoveryResult {
  return {
    recovered: 0,
    failed: 0,
    failures: [],
    mergeFailures: [],
  };
}

export function recordThreadRecoverySuccess(summary: SessionRecoveryResult): SessionRecoveryResult {
  return { ...summary, recovered: summary.recovered + 1 };
}

export function recordThreadRecoveryFailure(
  summary: SessionRecoveryResult,
  failure: SessionRecoveryResult["failures"][number],
): SessionRecoveryResult {
  return {
    ...summary,
    failed: summary.failed + 1,
    failures: [...summary.failures, failure],
  };
}

export function applyMergeRecoveryResult(
  summary: SessionRecoveryResult,
  mergeRecovery: {
    recovered: number;
    failed: number;
    failures: Array<{
      projectId: string;
      branchName: string;
      reason: string;
    }>;
  }
): SessionRecoveryResult {
  return {
    ...summary,
    recovered: summary.recovered + mergeRecovery.recovered,
    failed: summary.failed + mergeRecovery.failed,
    mergeFailures: [...summary.mergeFailures, ...mergeRecovery.failures],
  };
}
