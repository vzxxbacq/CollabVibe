import { OrchestratorError, ErrorCode } from "./errors";
import type { ProjectResolver } from "./project-resolver";
import type { ThreadService } from "./thread-state/thread-service";
import type { TurnDetailRepository } from "./turn-state/turn-detail-repository";
import type { TurnRepository } from "./turn-state/turn-repository";

export interface TurnServiceBaseDeps {
  turnRepository: TurnRepository;
  turnDetailRepository: TurnDetailRepository;
  threadService: ThreadService;
  projectResolver?: ProjectResolver;
  nowIso: () => string;
}

export abstract class TurnServiceBase {
  protected constructor(protected readonly deps: TurnServiceBaseDeps) {}

  protected requireProjectId(chatId: string): string {
    if (!this.deps.projectResolver) {
      if (!chatId) throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, "chatId is required when projectResolver is unavailable");
      return chatId;
    }
    const projectId = this.deps.projectResolver.findProjectByChatId(chatId)?.id;
    if (!projectId) throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found for chatId: ${chatId}`);
    return projectId;
  }

  protected storageProjectId(projectId: string, chatId: string): string {
    return this.deps.projectResolver ? projectId : chatId;
  }

  protected async getThreadTurnState(chatId: string, threadName: string) {
    return this.deps.threadService.getRuntimeState(this.requireProjectId(chatId), threadName);
  }
}
