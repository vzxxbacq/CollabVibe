import { OrchestratorError, ErrorCode } from "../errors";
import { createLogger } from "../../packages/logger/src/index";
import { TurnServiceBase, type TurnServiceBaseDeps } from "./turn-service-base";
import type { TurnDetailAggregate, TurnListItem } from "./contracts";
import type { TurnDetailRecord, TurnRecord } from "./types";
import type { TurnCardData } from "./turn-card-data-provider";
import { parseDiffFiles, splitDiffByFile } from "../../packages/git-utils/src/index";
import { parseMergeResolverName } from "../merge/merge-naming";

const log = createLogger("turn-query");

export class TurnQueryService extends TurnServiceBase {
  constructor(deps: TurnServiceBaseDeps) {
    super(deps);
  }

  async getTurnRecord(projectId: string, turnId: string): Promise<TurnRecord | null> {
    return this.deps.turnRepository.getByTurnId(await this.requireProjectId(projectId), turnId);
  }

  async getTurnRecordByCallId(projectId: string, callId: string): Promise<TurnRecord | null> {
    return this.deps.turnRepository.getByCallId(await this.requireProjectId(projectId), callId);
  }

  async getTurnRecordStrict(projectId: string, turnId: string): Promise<TurnRecord> {
    const resolvedProjectId = await this.requireProjectId(projectId);
    const record = await this.deps.turnRepository.getByTurnId(resolvedProjectId, turnId);
    if (!record) {
      throw new OrchestratorError(ErrorCode.TURN_RECORD_MISSING, "turn record not found", { projectId: resolvedProjectId, turnId });
    }
    return record;
  }

  async getActiveTurnRecord(projectId: string, threadName: string): Promise<TurnRecord | null> {
    const resolvedProjectId = await this.requireProjectId(projectId);
    const turnId = await this.deps.threadService.getActiveTurnId(resolvedProjectId, threadName);
    if (!turnId) return null;
    return this.deps.turnRepository.getByTurnId(resolvedProjectId, turnId);
  }

  async getLatestRelevantTurnRecord(projectId: string, threadName: string): Promise<TurnRecord | null> {
    const resolvedProjectId = await this.requireProjectId(projectId);
    const turnId = await this.deps.threadService.getLatestRelevantTurnId(resolvedProjectId, threadName);
    if (!turnId) return null;
    return this.deps.turnRepository.getByTurnId(resolvedProjectId, turnId);
  }

  async getTurnDetail(projectId: string, turnId: string): Promise<TurnDetailAggregate> {
    const record = await this.getTurnRecordStrict(projectId, turnId);
    const resolvedProjectId = await this.requireProjectId(projectId);
    const detail = await this.deps.turnDetailRepository.getByTurnId(resolvedProjectId, turnId);
    if (!detail) {
      throw new OrchestratorError(ErrorCode.TURN_DETAIL_MISSING, "turn detail not found", { projectId: resolvedProjectId, turnId });
    }
    return { record, detail };
  }

  /**
   * Assemble TurnCardData DTO from turn record + detail.
   * Extracted from orchestrator.ts (C4) — pure data assembly, no orchestrator state.
   */
  async getTurnCardData(projectId: string, turnId: string): Promise<TurnCardData | null> {
    const record = await this.getTurnRecord(projectId, turnId);
    if (!record) return null;
    let detail: TurnDetailRecord | null = null;
    try {
      const agg = await this.getTurnDetail(projectId, turnId);
      detail = agg.detail;
    } catch (err) {
      log.warn({ projectId, turnId, err: err instanceof Error ? err.message : String(err) }, "getTurnCardData: detail missing (non-critical, old turn)");
    }
    const fileChanges: TurnCardData["fileChanges"] = [];
    if (record.filesChanged && record.filesChanged.length > 0) {
      const raw = record.diffSummary ?? "";
      fileChanges.push({ filesChanged: record.filesChanged, diffSummary: raw, stats: record.stats, diffFiles: parseDiffFiles(raw), diffSegments: splitDiffByFile(raw) });
    }
    return {
      turnId: record.turnId,
      threadName: record.threadName,
      isMergeResolver: parseMergeResolverName(record.threadName) !== null,
      turnNumber: record.turnNumber,
      backendName: detail?.backendName,
      modelName: detail?.modelName,
      message: detail?.message ?? record.lastAgentMessage,
      reasoning: detail?.reasoning,
      turnMode: detail?.turnMode,
      tools: detail?.tools ?? [],
      toolOutputs: detail?.toolOutputs ?? [],
      planState: detail?.planState,
      promptSummary: detail?.promptSummary,
      agentNote: detail?.agentNote,
      fileChanges,
      tokenUsage: record.tokenUsage,
      status: record.status,
    };
  }

  async listTurns(projectId: string, limit = 20): Promise<TurnListItem[]> {
    const resolvedProjectId = await this.requireProjectId(projectId);
    const turns = await this.deps.turnRepository.listByProject(resolvedProjectId, limit);
    return Promise.all(turns.map(async (turn, index) => {
      const detail = await this.deps.turnDetailRepository.getByTurnId(resolvedProjectId, turn.turnId);
      const threadRecord = await this.deps.threadService.getRecord(resolvedProjectId, turn.threadName);
      return {
        projectId: resolvedProjectId,
        turnId: turn.turnId,
        threadId: turn.threadId,
        threadName: turn.threadName,
        turnNumber: turn.turnNumber ?? (turns.length - index),
        status: turn.status,
        promptSummary: detail?.promptSummary ?? turn.lastAgentMessage?.slice(0, 20),
        lastAgentMessage: detail?.message ?? turn.lastAgentMessage,
        backendName: detail?.backendName ?? threadRecord?.backend.backendId,
        modelName: detail?.modelName ?? threadRecord?.backend.model,
        filesChangedCount: turn.filesChanged?.length ?? 0,
        tokenUsage: turn.tokenUsage,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
        completedAt: turn.completedAt,
      };
    }));
  }
}
