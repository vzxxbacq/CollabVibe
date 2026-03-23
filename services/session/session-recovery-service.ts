import { createLogger } from "../../packages/logger/src/index";
import type { MergeUseCase } from "../merge/merge-service";
import type { ProjectResolver } from "../project/project-resolver";
import type { ThreadRuntimeService } from "../thread/thread-runtime-service";
import type { ThreadRecord } from "../thread/types";
import type { ThreadService } from "../thread/thread-service";
import { classifyRecoveryFailure } from "./recovery-classifier";
import { parseMergeResolverName } from "../merge/merge-naming";
import {
  applyMergeRecoveryResult,
  createEmptyRecoverySummary,
  recordThreadRecoveryFailure,
  recordThreadRecoverySuccess
} from "./recovery-summary";

const log = createLogger("session-recovery");

export type SessionRecoveryFailureCategory =
  | "CONFIG_ERROR"
  | "BACKEND_SESSION_MISSING"
  | "WORKTREE_MISSING"
  | "SKILL_SYNC_FAILED"
  | "UNKNOWN";

export interface SessionRecoveryResult {
  recovered: number;
  failed: number;
  failures: Array<{
    projectId: string;
    threadName: string;
    category: SessionRecoveryFailureCategory;
    reason: string;
  }>;
  mergeFailures: Array<{
    projectId: string;
    branchName: string;
    reason: string;
  }>;
}

export class SessionRecoveryService {
  constructor(private readonly deps: {
    projectResolver: ProjectResolver;
    threadRuntimeService: ThreadRuntimeService;
    threadService: ThreadService;
    mergeUseCase: MergeUseCase;
    releaseSessionStateByPrefix: (projectId: string) => void;
  }) {}

  async onProjectDeactivated(projectId: string): Promise<void> {
    log.info({ projectId }, "onProjectDeactivated: releasing sessions");
    await this.deps.threadRuntimeService.releaseByPrefix(projectId);
    this.deps.releaseSessionStateByPrefix(projectId);
  }

  async recoverSessions(activeProjectIds: string[]): Promise<SessionRecoveryResult> {
    let summary = createEmptyRecoverySummary();
    const projectIdSet = new Set(activeProjectIds);

    for (const record of this.deps.threadService.listAllRecords()) {
      const recordProjectId = record.projectId;
      if (!recordProjectId) {
        const reason = `thread ${record.threadName} is missing required projectId`;
        log.warn({ threadName: record.threadName, threadId: record.threadId }, reason);
        summary = recordThreadRecoveryFailure(summary, { projectId: "", threadName: record.threadName, category: "CONFIG_ERROR", reason });
        continue;
      }
      if (!projectIdSet.has(recordProjectId)) {
        continue;
      }

      try {
        await this.recoverThreadSession({
          projectId: recordProjectId,
          threadName: record.threadName,
          threadRecord: record,
        });
        summary = recordThreadRecoverySuccess(summary);
      } catch (error) {
        const { category, reason } = classifyRecoveryFailure(error);
        log.warn({ projectId: recordProjectId, threadName: record.threadName, category, err: reason }, "session recovery failed for thread");
        summary = recordThreadRecoveryFailure(summary, { projectId: recordProjectId, threadName: record.threadName, category, reason });
      }
    }

    const mergeRecovery = await this.deps.mergeUseCase.recoverSessions(activeProjectIds);
    summary = applyMergeRecoveryResult(summary, mergeRecovery);
    log.info({ ...summary }, "session recovery complete");
    return summary;
  }

  private async recoverThreadSession(params: {
    projectId: string;
    threadName: string;
    threadRecord: ThreadRecord;
  }): Promise<void> {
    log.info({
      projectId: params.projectId,
      threadName: params.threadName,
      backend: params.threadRecord.backend.backendId,
      model: params.threadRecord.backend.model,
      worktreePath: params.threadRecord.worktreePath,
      isMergeResolver: parseMergeResolverName(params.threadName) !== null,
      branchName: parseMergeResolverName(params.threadName) ?? undefined,
    }, "recovering agent API from persisted ThreadRecord");
    await this.deps.threadRuntimeService.getOrCreateForExistingThread(params);
  }
}
