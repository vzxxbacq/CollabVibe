import type { PersistedMergeSessionRecord } from "./merge-session-repository";
import type { MergeSession } from "./merge-session-model";

export function toPersistedMergeSessionRecord(session: MergeSession): PersistedMergeSessionRecord {
  return {
    projectId: session.projectId,
    chatId: session.chatId,
    branchName: session.branchName,
    baseBranch: session.baseBranch,
    mainCwd: session.mainCwd,
    worktreeCwd: session.worktreeCwd,
    preMergeSha: session.preMergeSha,
    files: session.files.map((file) => ({ ...file })),
    currentIndex: session.currentIndex,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: Date.now(),
    activeAgentFilePath: session.activeAgentFilePath,
    agentRetryBaseline: session.agentRetryBaseline,
    traceId: session.traceId,
    threadId: session.threadId,
    turnId: session.turnId,
    userId: session.userId,
    resolverName: session.resolverName,
    resolverBackendId: session.resolverBackendId,
    resolverModel: session.resolverModel,
    recoveryError: session.recoveryError,
  };
}

export function fromPersistedMergeSessionRecord(record: PersistedMergeSessionRecord): MergeSession {
  return {
    projectId: record.projectId,
    chatId: record.chatId,
    branchName: record.branchName,
    baseBranch: record.baseBranch,
    mainCwd: record.mainCwd,
    worktreeCwd: record.worktreeCwd,
    preMergeSha: record.preMergeSha,
    files: record.files.map((file) => ({ ...file })),
    currentIndex: record.currentIndex,
    state: record.state,
    createdAt: record.createdAt,
    activeAgentFilePath: record.activeAgentFilePath,
    agentRetryBaseline: record.agentRetryBaseline,
    traceId: record.traceId,
    threadId: record.threadId,
    turnId: record.turnId,
    userId: record.userId,
    resolverName: record.resolverName,
    resolverBackendId: record.resolverBackendId,
    resolverModel: record.resolverModel,
    recoveryError: record.recoveryError,
  };
}
