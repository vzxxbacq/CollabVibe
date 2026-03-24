import { ThreadEventRuntime } from "./thread-event-runtime";
import type { PipelineCallbacks } from "./pipeline-types";
import { AgentEventRouter } from "./router";

export class ThreadRuntimeRegistry {
  private readonly runtimes = new Map<string, ThreadEventRuntime>();
  private readonly turnRuntimeKeys = new Map<string, string>();

  constructor(
    private readonly eventRouter: AgentEventRouter,
    private readonly callbacks: PipelineCallbacks,
    private readonly options?: {
      contextTtlMs?: number;
      streamOutput?: {
        persistWindowMs?: number;
        persistMaxWaitMs?: number;
        persistMaxChars?: number;
        uiWindowMs?: number;
        uiMaxWaitMs?: number;
        uiMaxChars?: number;
      };
    }
  ) {}

  getOrCreate(projectId: string, threadName: string): ThreadEventRuntime {
    const key = this.runtimeKey(projectId, threadName);
    const existing = this.runtimes.get(key);
    if (existing) {
      return existing;
    }
    const created = new ThreadEventRuntime(projectId, this.eventRouter, this.callbacks, this.options);
    this.runtimes.set(key, created);
    return created;
  }

  bindTurn(projectId: string, threadName: string, turnId: string): void {
    this.turnRuntimeKeys.set(this.turnKey(projectId, turnId), this.runtimeKey(projectId, threadName));
  }

  getByTurn(projectId: string, turnId: string): ThreadEventRuntime | null {
    const indexedRuntimeKey = this.turnRuntimeKeys.get(this.turnKey(projectId, turnId));
    if (!indexedRuntimeKey) {
      return null;
    }
    return this.runtimes.get(indexedRuntimeKey) ?? null;
  }

  listByProject(projectId: string): ThreadEventRuntime[] {
    return [...this.runtimes.entries()]
      .filter(([key]) => key.startsWith(`${projectId}:`))
      .map(([, runtime]) => runtime);
  }

  listAll(): ThreadEventRuntime[] {
    return [...this.runtimes.values()];
  }

  private runtimeKey(projectId: string, threadName: string): string {
    return `${projectId}:${threadName}`;
  }

  private turnKey(projectId: string, turnId: string): string {
    return `${projectId}:${turnId}`;
  }
}

