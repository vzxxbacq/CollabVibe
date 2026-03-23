import { diffSnapshot, restoreSnapshot, type SnapshotDiff } from "../../../../packages/git-utils/src/snapshot";
import type { SnapshotRepository, TurnSnapshotRecord } from "./snapshot-types";
import type { TurnQueryService } from "../turn/turn-query-service";
import { OrchestratorError, ErrorCode } from "../errors";

export class SnapshotService {
  constructor(
    private readonly snapshotRepo: SnapshotRepository | undefined,
    private readonly turnQueryService: TurnQueryService,
  ) {}

  async getSnapshotDiff(chatId: string, threadName: string): Promise<SnapshotDiff | null> {
    const turn = await this.turnQueryService.getLatestRelevantTurnRecord(chatId, threadName);
    if (!turn?.snapshotSha) return null;
    return diffSnapshot(turn.cwd, turn.snapshotSha);
  }

  async listSnapshots(projectId: string, threadId: string): Promise<TurnSnapshotRecord[]> {
    if (!this.snapshotRepo) return [];
    return this.snapshotRepo.listByThread(projectId, threadId);
  }

  async jumpToSnapshot(
    projectId: string,
    targetTurnId: string,
  ): Promise<{ snapshot: TurnSnapshotRecord; latestIndex: number }> {
    if (!this.snapshotRepo) {
      throw new OrchestratorError(ErrorCode.SNAPSHOT_REPO_MISSING, "snapshot repository not configured");
    }
    const target = await this.snapshotRepo.getByTurnId(projectId, targetTurnId);
    if (!target) {
      throw new OrchestratorError(ErrorCode.SNAPSHOT_NOT_FOUND, "snapshot not found");
    }
    await restoreSnapshot(target.cwd, target.gitRef);
    const latestIndex = await this.snapshotRepo.getLatestIndex(projectId, target.threadId);
    return { snapshot: target, latestIndex };
  }

  async updateSnapshotSummary(projectId: string, chatId: string, turnId: string, summary: string, files: string[]): Promise<void> {
    if (!this.snapshotRepo) return;
    const turn = await this.turnQueryService.getTurnRecord(chatId, turnId);
    if (!turn) return;
    await this.snapshotRepo.updateSummary(projectId, turn.threadId, turnId, summary, files);
  }
}
