import type { MergeFileDecision, MergeFileStatus, IMFileMergeReview, IMMergeSummary } from "../event/im-output";
import type { MergeSession } from "./merge-session-model";

export function availableDecisionsForStatus(status: MergeFileStatus): MergeFileDecision[] {
  switch (status) {
    case "auto_merged":     return ["accept", "keep_main", "use_branch"];
    case "agent_resolved":  return ["accept"];
    case "conflict":        return ["keep_main", "use_branch"];
    case "added":           return ["accept", "skip"];
    case "deleted":         return ["accept", "keep_main"];
    default:                return ["accept", "keep_main", "use_branch"];
  }
}

export function buildFileReview(session: MergeSession): IMFileMergeReview {
  const file = session.files[session.currentIndex]!;
  const accepted = session.files.filter(f => f.decision === "accept").length;
  const rejected = session.files.filter(f => f.decision !== "pending" && f.decision !== "accept").length;
  const remaining = session.files.filter(f => f.decision === "pending").length;
  const pendingConflicts = session.files.filter((f) => f.decision === "pending" && f.status === "conflict");
  const pendingDirect = session.files.filter((f) => f.decision === "pending" && f.status !== "conflict" && f.status !== "agent_pending");
  const agentPending = session.files.filter((f) => f.status === "agent_pending");
  const agentResolved = session.files.filter((f) => f.decision === "pending" && f.status === "agent_resolved");
  return {
    kind: "file_merge_review",
    branchName: session.branchName,
    baseBranch: session.baseBranch,
    sessionState: session.state,
    resolverBackendId: session.resolverBackendId,
    resolverModel: session.resolverModel,
    fileIndex: session.currentIndex,
    totalFiles: session.files.length,
    file: { path: file.path, diff: file.diff, status: file.status },
    availableDecisions: availableDecisionsForStatus(file.status),
    overview: {
      decided: session.files.length - remaining,
      pending: remaining,
      pendingConflicts: pendingConflicts.length,
      pendingDirect: pendingDirect.length,
      agentPending: agentPending.length,
      accepted,
      keptBase: session.files.filter((f) => f.decision === "keep_main").length,
      usedBranch: session.files.filter((f) => f.decision === "use_branch").length,
      skipped: session.files.filter((f) => f.decision === "skip").length,
    },
    queues: {
      conflictPaths: pendingConflicts.map((f) => f.path),
      directPaths: pendingDirect.map((f) => f.path),
      agentPendingPaths: agentPending.map((f) => f.path),
      agentResolvedPaths: agentResolved.map((f) => f.path),
    },
    recoveryError: session.recoveryError,
    progress: { accepted, rejected, remaining }
  };
}

export function firstPendingIndex(session: MergeSession): number {
  const firstPendingConflict = session.files.findIndex((file) => file.decision === "pending" && file.status === "conflict");
  if (firstPendingConflict >= 0) {
    return firstPendingConflict;
  }
  return session.files.findIndex((file) => file.decision === "pending");
}

export function buildMergeSummary(session: MergeSession): IMMergeSummary {
  const files = session.files.map(f => ({
    path: f.path,
    decision: f.decision === "pending" ? "skip" as MergeFileDecision : f.decision,
    status: f.status
  }));
  return {
    kind: "merge_result_summary",
    branchName: session.branchName,
    baseBranch: session.baseBranch,
    files,
    hasPartialMerge: files.some(f => f.decision !== "accept")
  };
}
