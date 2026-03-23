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

  protected requireProjectId(projectId: string): string {
    const resolvedProjectId = this.deps.projectResolver.findProjectById?.(projectId)?.id ?? null;
    if (!resolvedProjectId) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found: ${projectId}`);
    }
    return resolvedProjectId;
  }

  protected async getThreadTurnState(projectId: string, threadName: string) {
    return this.deps.threadService.getRuntimeState(this.requireProjectId(projectId), threadName);
  }
}
