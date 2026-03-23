import { OrchestratorError, ErrorCode } from "../errors";
import type { ProjectResolver } from "../project/project-resolver";
import type { ThreadService } from "../thread/thread-service";
import type { TurnDetailRepository } from "./turn-detail-repository";
import type { TurnRepository } from "./turn-repository";

export interface TurnServiceBaseDeps {
  turnRepository: TurnRepository;
  turnDetailRepository: TurnDetailRepository;
  threadService: ThreadService;
  projectResolver: ProjectResolver;
  nowIso: () => string;
}

export abstract class TurnServiceBase {
  protected constructor(protected readonly deps: TurnServiceBaseDeps) {}

  protected requireProjectId(chatId: string): string {
    const projectId = this.deps.projectResolver.findProjectByChatId(chatId)?.id;
    if (!projectId) throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found for chatId: ${chatId}`);
    return projectId;
  }

  protected async getThreadTurnState(chatId: string, threadName: string) {
    return this.deps.threadService.getRuntimeState(this.requireProjectId(chatId), threadName);
  }
}
