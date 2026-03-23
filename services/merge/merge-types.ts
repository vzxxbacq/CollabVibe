import type { IMOutputMessage } from "../event/im-output";
import type { ThreadRouteBinding, RouteBinding } from "../event/pipeline";
import type { MergeDiffStats } from "../../packages/git-utils/src/index";

/** MergeUseCase's minimal dependency surface on the turn pipeline. */
export interface MergeTurnPipeline {
  routeMessage(projectId: string, msg: IMOutputMessage): Promise<void>;
  prepareTurn(route: ThreadRouteBinding): void;
  activateTurn(route: RouteBinding): void;
  registerTurnCompleteHook(
    projectId: string,
    threadName: string,
    hook: (turnId: string) => Promise<void>,
  ): void;
  unregisterTurnCompleteHook(projectId: string, threadName: string): void;
}

export interface PendingMerge {
  projectId: string;
  branchName: string;
  mergeBranch?: string;
  diffStats?: MergeDiffStats;
  preMergeSha?: string;
}
