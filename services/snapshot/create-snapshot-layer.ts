/**
 * @module snapshot/create-snapshot-layer
 *
 * Domain sub-factory for Snapshot services.
 */
import type { SnapshotRepository } from "./contracts";
import type { TurnQueryService } from "../turn/turn-query-service";
import type { ThreadService } from "../thread/thread-service";
import type { ThreadRuntimeService } from "../thread/thread-runtime-service";
import { SnapshotService } from "./snapshot-service";
import type { GitOps } from "../../packages/git-utils/src/index";

export interface SnapshotLayerDeps {
  snapshotRepo?: SnapshotRepository;
  turnQueryService: TurnQueryService;
  threadService?: ThreadService;
  threadRuntimeService?: ThreadRuntimeService;
  gitOps?: GitOps;
}

export interface SnapshotLayer {
  snapshotService: SnapshotService;
}

export function createSnapshotLayer(deps: SnapshotLayerDeps): SnapshotLayer {
  return {
    snapshotService: new SnapshotService(
      deps.snapshotRepo,
      deps.turnQueryService,
      deps.threadService,
      deps.threadRuntimeService,
      deps.gitOps,
    ),
  };
}
