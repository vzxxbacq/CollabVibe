import { OrchestratorError, ErrorCode } from "../errors";
import { TurnServiceBase, type TurnServiceBaseDeps } from "./turn-service-base";
import type { TurnDetailAggregate, TurnListItem } from "./turn-types";
import type { TurnRecord } from "./turn-record";

export class TurnQueryService extends TurnServiceBase {
  constructor(deps: TurnServiceBaseDeps) {
    super(deps);
  }

  async getTurnRecord(chatId: string, turnId: string): Promise<TurnRecord | null> {
    return this.deps.turnRepository.getByTurnId(this.requireProjectId(chatId), turnId);
  }

  async getTurnRecordStrict(chatId: string, turnId: string): Promise<TurnRecord> {
    const projectId = this.requireProjectId(chatId);
    const record = await this.deps.turnRepository.getByTurnId(projectId, turnId);
    if (!record) {
      throw new OrchestratorError(ErrorCode.TURN_RECORD_MISSING, "turn record not found", { projectId, chatId, turnId });
    }
    return record;
  }

  async getActiveTurnRecord(chatId: string, threadName: string): Promise<TurnRecord | null> {
    const projectId = this.requireProjectId(chatId);
    const turnId = await this.deps.threadService.getActiveTurnId(projectId, threadName);
    if (!turnId) return null;
    return this.deps.turnRepository.getByTurnId(projectId, turnId);
  }

  async getLatestRelevantTurnRecord(chatId: string, threadName: string): Promise<TurnRecord | null> {
    const projectId = this.requireProjectId(chatId);
    const turnId = await this.deps.threadService.getLatestRelevantTurnId(projectId, threadName);
    if (!turnId) return null;
    return this.deps.turnRepository.getByTurnId(projectId, turnId);
  }

  async getTurnDetail(chatId: string, turnId: string): Promise<TurnDetailAggregate> {
    const record = await this.getTurnRecordStrict(chatId, turnId);
    const projectId = this.requireProjectId(chatId);
    const detail = await this.deps.turnDetailRepository.getByTurnId(projectId, turnId);
    if (!detail) {
      throw new OrchestratorError(ErrorCode.TURN_DETAIL_MISSING, "turn detail not found", { projectId, chatId, turnId });
    }
    return { record, detail };
  }

  async listTurns(chatId: string, limit = 20): Promise<TurnListItem[]> {
    const projectId = this.requireProjectId(chatId);
    const turns = await this.deps.turnRepository.listByProject(projectId, limit);
    return Promise.all(turns.map(async (turn, index) => {
      const detail = await this.deps.turnDetailRepository.getByTurnId(projectId, turn.turnId);
      const threadRecord = this.deps.threadService.getRecord(projectId, turn.threadName);
      return {
        projectId,
        chatId,
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
