import type { SnapshotDiff } from "../../packages/git-utils/src/index";
import type { GitOps } from "../../packages/git-utils/src/index";
import type { SnapshotRepository } from "./contracts";
import type { TurnSnapshotRecord } from "./types";
import type { TurnQueryService } from "../turn/turn-query-service";
import type { ThreadService } from "../thread/thread-service";
import type { ThreadRuntimeService } from "../thread/thread-runtime-service";
import { createLogger } from "../../packages/logger/src/index";
import { OrchestratorError, ErrorCode } from "../errors";

const log = createLogger("snapshot-service");

export class SnapshotService {
  constructor(
    private readonly snapshotRepo: SnapshotRepository | undefined,
    private readonly turnQueryService: TurnQueryService,
    private readonly threadService?: ThreadService,
    private readonly threadRuntimeService?: ThreadRuntimeService,
    private readonly gitOps?: GitOps,
  ) {}

  async getSnapshotDiff(projectId: string, threadName: string): Promise<SnapshotDiff | null> {
    const turn = await this.turnQueryService.getLatestRelevantTurnRecord(projectId, threadName);
    if (!turn?.snapshotSha) return null;
    return this.gitOps!.snapshot.diff(turn.cwd, turn.snapshotSha);
  }

  async listSnapshots(projectId: string, threadId: string): Promise<TurnSnapshotRecord[]> {
    if (!this.snapshotRepo) return [];
    return this.snapshotRepo.listByThread(projectId, threadId);
  }

  async jumpToSnapshot(
    projectId: string,
    targetTurnId: string,
    userId?: string,
  ): Promise<{ snapshot: TurnSnapshotRecord; latestIndex: number; contextReset: boolean }> {
    if (!this.snapshotRepo) {
      throw new OrchestratorError(ErrorCode.SNAPSHOT_REPO_MISSING, "snapshot repository not configured");
    }
    const target = await this.snapshotRepo.getByTurnId(projectId, targetTurnId);
    if (!target) {
      throw new OrchestratorError(ErrorCode.SNAPSHOT_NOT_FOUND, "snapshot not found");
    }
    await this.gitOps!.snapshot.restore(target.cwd, target.gitRef);
    const latestIndex = await this.snapshotRepo.getLatestIndex(projectId, target.threadId);
    const numTurns = latestIndex - target.turnIndex + 1;
    let contextReset = false;

    if (numTurns > 0 && userId) {
      const threadName = (await this.threadService?.getUserBinding(projectId, userId))?.threadName;
      if (threadName) {
        const api = await this.threadRuntimeService?.resolveRequiredApi(projectId, threadName);
        if (api?.threadRollback) {
          try {
            await api.threadRollback(target.threadId, numTurns);
          } catch (error) {
            log.warn({
              projectId,
              threadName,
              threadId: target.threadId,
              turns: numTurns,
              err: error instanceof Error ? error.message : String(error),
            }, "threadRollback failed; UI should surface context reset");
            contextReset = true;
          }
        }
      }
    }

    return { snapshot: target, latestIndex, contextReset };
  }

  async updateSnapshotSummary(projectId: string, turnId: string, summary: string, files: string[]): Promise<void> {
    if (!this.snapshotRepo) return;
    const turn = await this.turnQueryService.getTurnRecord(projectId, turnId);
    if (!turn) return;
    await this.snapshotRepo.updateSummary(projectId, turn.threadId, turnId, summary, files);
  }
}
