import { createLogger } from "../../packages/logger/src/index";
import type { PlatformOutput } from "./output-contracts";
import { classifyPlatformOutput } from "./output-aggregation-policy";

interface BufferedOutput {
  projectId: string;
  output: PlatformOutput;
  collapseKey: string;
  mode: "latest" | "append_window";
  enqueuedAt: number;
  turnId?: string;
  timer?: ReturnType<typeof setTimeout>;
  maxWaitTimer?: ReturnType<typeof setTimeout>;
}

export interface OutputIntentBufferOptions {
  enqueue(projectId: string, output: PlatformOutput): Promise<void>;
}

const log = createLogger("output-intent-buffer");

/**
 * L2-only in-memory output shaper.
 * It may merge/debounce outputs before handing them off to L1 delivery queue,
 * but it must not wait for real platform network delivery.
 */
export class OutputIntentBuffer {
  private readonly buffers = new Map<string, BufferedOutput>();
  private readonly flushes = new Set<Promise<void>>();
  private readonly idleWaiters = new Set<() => void>();

  constructor(private readonly options: OutputIntentBufferOptions) {}

  async enqueuePlatformOutput(projectId: string, output: PlatformOutput): Promise<void> {
    const turnId = turnIdForOutput(output);
    if (shouldFlushRelatedBuffers(output) && turnId) {
      await this.flushTurnBuffers(projectId, turnId);
    }
    const decision = classifyPlatformOutput(projectId, output);
    if (decision.mode === "no_merge" || !decision.collapseKey) {
      await this.options.enqueue(projectId, output);
      return;
    }
    const existing = this.buffers.get(decision.collapseKey);
    if (!existing) {
      const buffered: BufferedOutput = {
        projectId,
        output,
        collapseKey: decision.collapseKey,
        mode: decision.mode,
        enqueuedAt: Date.now(),
        turnId,
      };
      log.info({ projectId, collapseKey: decision.collapseKey, mode: decision.mode, kind: output.kind }, "intent buffer created");
      buffered.timer = setTimeout(() => void this.flushBuffer(decision.collapseKey!), decision.windowMs ?? 2500);
      buffered.maxWaitTimer = setTimeout(() => void this.flushBuffer(decision.collapseKey!), decision.maxWaitMs ?? 4000);
      this.buffers.set(decision.collapseKey, buffered);
      return;
    }
    existing.output = mergeOutputs(existing.output, output, existing.mode);
    log.info({ projectId, collapseKey: decision.collapseKey, mode: existing.mode, kind: output.kind }, "intent buffer merged");
  }

  async flushAll(): Promise<void> {
    const keys = [...this.buffers.keys()];
    await Promise.all(keys.map((key) => this.flushBuffer(key)));
    await this.waitForIdle();
  }

  async waitForIdle(): Promise<void> {
    if (this.isIdle()) {
      return;
    }
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  private async flushTurnBuffers(projectId: string, turnId: string): Promise<void> {
    const keys = [...this.buffers.entries()]
      .filter(([, value]) => value.projectId === projectId && value.turnId === turnId)
      .map(([key]) => key);
    await Promise.all(keys.map((key) => this.flushBuffer(key)));
  }

  private async flushBuffer(collapseKey: string): Promise<void> {
    const buffered = this.buffers.get(collapseKey);
    if (!buffered) return;
    this.buffers.delete(collapseKey);
    if (buffered.timer) clearTimeout(buffered.timer);
    if (buffered.maxWaitTimer) clearTimeout(buffered.maxWaitTimer);
    log.info({
      projectId: buffered.projectId,
      collapseKey,
      kind: buffered.output.kind,
      bufferedForMs: Date.now() - buffered.enqueuedAt
    }, "intent buffer flushed");
    const flush = this.options.enqueue(buffered.projectId, buffered.output)
      .catch((error) => {
        log.warn({
          projectId: buffered.projectId,
          collapseKey,
          kind: buffered.output.kind,
          err: error instanceof Error ? error.message : String(error)
        }, "intent enqueue failed");
      })
      .finally(() => {
        this.flushes.delete(flush);
        this.notifyIdleIfNeeded();
      });
    this.flushes.add(flush);
    await flush;
  }

  private isIdle(): boolean {
    return this.buffers.size === 0 && this.flushes.size === 0;
  }

  private notifyIdleIfNeeded(): void {
    if (!this.isIdle()) {
      return;
    }
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    for (const resolve of waiters) {
      resolve();
    }
  }
}

function mergeOutputs(base: PlatformOutput, incoming: PlatformOutput, mode: "latest" | "append_window"): PlatformOutput {
  if (mode === "latest") {
    return incoming;
  }
  if (base.kind !== incoming.kind) {
    return incoming;
  }
  switch (base.kind) {
    case "content":
      return incoming.kind === "content"
        ? { ...base, data: { ...base.data, delta: base.data.delta + incoming.data.delta } }
        : incoming;
    case "reasoning":
      return incoming.kind === "reasoning"
        ? { ...base, data: { ...base.data, delta: base.data.delta + incoming.data.delta } }
        : incoming;
    case "plan":
      return incoming.kind === "plan"
        ? { ...base, data: { ...base.data, delta: base.data.delta + incoming.data.delta } }
        : incoming;
    case "tool_output":
      return incoming.kind === "tool_output"
        ? { ...base, data: { ...base.data, delta: base.data.delta + incoming.data.delta } }
        : incoming;
    default:
      return incoming;
  }
}

function turnIdForOutput(output: PlatformOutput): string | undefined {
  if ("data" in output && output.data && typeof output.data === "object" && "turnId" in output.data) {
    const turnId = (output.data as { turnId?: string }).turnId;
    return typeof turnId === "string" && turnId.length > 0 ? turnId : undefined;
  }
  return undefined;
}

function shouldFlushRelatedBuffers(output: PlatformOutput): boolean {
  switch (output.kind) {
    case "approval_request":
    case "user_input_request":
    case "turn_summary":
    case "plan_update":
    case "notification":
    case "platform_mutation":
      return true;
    default:
      return false;
  }
}
