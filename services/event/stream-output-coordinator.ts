import { createLogger } from "../../packages/logger/src/index";
import type { TurnStateSnapshot } from "../turn/turn-state";
import type { IMOutputMessage, IMToolOutputChunk } from "./im-output";

interface StreamOutputCoordinatorCallbacks {
  syncTurnState(projectId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void>;
  routeMessage(projectId: string, message: IMOutputMessage, options?: { skipPersist?: boolean }): Promise<void>;
}

interface AggregatedToolOutput extends Omit<IMToolOutputChunk, "delta"> {
  delta: string;
}

interface TurnStreamAggregateState {
  latestSnapshot: TurnStateSnapshot;
  dirtyFields: Set<"content" | "reasoning" | "plan" | "tool_output">;
  firstDirtyAt: number;
  lastPersistAt?: number;
  lastOutputFlushAt?: number;
  sequence: number;
  persistedSequence: number;
  outputSequence: number;
  pendingChars: {
    content: number;
    reasoning: number;
    plan: number;
    toolOutput: number;
  };
  contentDelta: string;
  reasoningDelta: string;
  planDelta: string;
  toolOutputDeltas: Map<string, AggregatedToolOutput>;
  pendingOrder: string[];
  outputTimer?: ReturnType<typeof setTimeout>;
  persistTimer?: ReturnType<typeof setTimeout>;
  persistInFlight?: Promise<void>;
  outputInFlight?: Promise<void>;
}

const log = createLogger("orchestrator");

export class StreamOutputCoordinator {
  private readonly states = new Map<string, TurnStreamAggregateState>();
  private readonly persistWindowMs: number;
  private readonly persistMaxWaitMs: number;
  private readonly persistMaxChars: number;
  private readonly uiWindowMs: number;
  private readonly uiMaxWaitMs: number;
  private readonly uiMaxChars: number;

  constructor(
    private readonly callbacks: StreamOutputCoordinatorCallbacks,
    options?: {
      persistWindowMs?: number;
      persistMaxWaitMs?: number;
      persistMaxChars?: number;
      uiWindowMs?: number;
      uiMaxWaitMs?: number;
      uiMaxChars?: number;
    }
  ) {
    this.persistWindowMs = options?.persistWindowMs ?? 500;
    this.persistMaxWaitMs = options?.persistMaxWaitMs ?? 2000;
    this.persistMaxChars = options?.persistMaxChars ?? 2048;
    this.uiWindowMs = options?.uiWindowMs ?? 400;
    this.uiMaxWaitMs = options?.uiMaxWaitMs ?? 1200;
    this.uiMaxChars = options?.uiMaxChars ?? 1024;
    log.info({
      persistWindowMs: this.persistWindowMs,
      persistMaxWaitMs: this.persistMaxWaitMs,
      persistMaxChars: this.persistMaxChars,
      uiWindowMs: this.uiWindowMs,
      uiMaxWaitMs: this.uiMaxWaitMs,
      uiMaxChars: this.uiMaxChars
    }, "stream coordinator configured");
  }

  async ingest(projectId: string, threadName: string, turnId: string, snapshot: TurnStateSnapshot, message: IMOutputMessage): Promise<void> {
    const state = this.getOrCreateState(projectId, turnId, snapshot);
    state.latestSnapshot = snapshot;
    this.aggregateMessage(state, message);

    const now = Date.now();
    const bufferedForMs = now - state.firstDirtyAt;
    const pendingChars = this.totalPendingChars(state);

    this.schedulePersist(projectId, threadName, turnId, state, now);
    this.scheduleUi(projectId, threadName, turnId, state, now);

    if (pendingChars >= this.persistMaxChars || bufferedForMs >= this.persistMaxWaitMs) {
      void this.flushPersist(projectId, threadName, turnId, "threshold");
    }
    if (pendingChars >= this.uiMaxChars || bufferedForMs >= this.uiMaxWaitMs) {
      void this.flushUi(projectId, threadName, turnId, "threshold");
    }
  }

  markSnapshotDirty(projectId: string, turnId: string, snapshot: TurnStateSnapshot): void {
    const state = this.getOrCreateState(projectId, turnId, snapshot);
    state.latestSnapshot = snapshot;
    if (state.dirtyFields.size === 0) {
      state.firstDirtyAt = Date.now();
    }
    state.dirtyFields.add("content");
    state.sequence += 1;
    this.schedulePersist(projectId, "", turnId, state, Date.now());
  }

  async flushForCriticalMessage(projectId: string, threadName: string, turnId: string, reason: string): Promise<void> {
    await this.forceFlush(projectId, threadName, turnId, `critical:${reason}`);
  }

  async forceFlush(projectId: string, threadName: string, turnId: string, reason = "force"): Promise<void> {
    const key = this.stateKey(projectId, turnId);
    const state = this.states.get(key);
    if (!state) {
      return;
    }
    log.info({
      projectId,
      threadName,
      turnId,
      dirtyFields: [...state.dirtyFields],
      pendingChars: state.pendingChars,
      hasPendingOutput: state.pendingOrder.length > 0,
      reason
    }, "stream forceFlush");
    await this.flushPersist(projectId, threadName, turnId, reason);
    await this.flushUi(projectId, threadName, turnId, reason);
  }

  cleanup(projectId: string, turnId: string): void {
    const key = this.stateKey(projectId, turnId);
    const state = this.states.get(key);
    if (!state) {
      return;
    }
    if (state.persistTimer) {
      clearTimeout(state.persistTimer);
    }
    if (state.outputTimer) {
      clearTimeout(state.outputTimer);
    }
    this.states.delete(key);
    log.info({
      projectId,
      turnId,
      dirtyFields: [...state.dirtyFields],
      pendingChars: state.pendingChars,
      hasPendingOutput: state.pendingOrder.length > 0
    }, "stream cleanup");
  }

  private getOrCreateState(projectId: string, turnId: string, snapshot: TurnStateSnapshot): TurnStreamAggregateState {
    const key = this.stateKey(projectId, turnId);
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }
    const created: TurnStreamAggregateState = {
      latestSnapshot: snapshot,
      dirtyFields: new Set(),
      firstDirtyAt: Date.now(),
      sequence: 0,
      persistedSequence: 0,
      outputSequence: 0,
      pendingChars: {
        content: 0,
        reasoning: 0,
        plan: 0,
        toolOutput: 0
      },
      contentDelta: "",
      reasoningDelta: "",
      planDelta: "",
      toolOutputDeltas: new Map(),
      pendingOrder: []
    };
    this.states.set(key, created);
    return created;
  }

  private aggregateMessage(state: TurnStreamAggregateState, message: IMOutputMessage): void {
    if (state.dirtyFields.size === 0) {
      state.firstDirtyAt = Date.now();
    }
    state.sequence += 1;
    switch (message.kind) {
      case "content":
        state.contentDelta += message.delta;
        state.pendingChars.content += message.delta.length;
        state.dirtyFields.add("content");
        this.pushPendingOrder(state, "content");
        break;
      case "reasoning":
        state.reasoningDelta += message.delta;
        state.pendingChars.reasoning += message.delta.length;
        state.dirtyFields.add("reasoning");
        this.pushPendingOrder(state, "reasoning");
        break;
      case "plan":
        state.planDelta += message.delta;
        state.pendingChars.plan += message.delta.length;
        state.dirtyFields.add("plan");
        this.pushPendingOrder(state, "plan");
        break;
      case "tool_output": {
        const key = `tool_output:${message.callId}`;
        const existing = state.toolOutputDeltas.get(key);
        if (existing) {
          existing.delta += message.delta;
        } else {
          state.toolOutputDeltas.set(key, { ...message });
          this.pushPendingOrder(state, key);
        }
        state.pendingChars.toolOutput += message.delta.length;
        state.dirtyFields.add("tool_output");
        break;
      }
      default:
        throw new Error(`stream-output-coordinator received non-streaming message: ${message.kind}`);
    }
  }

  private pushPendingOrder(state: TurnStreamAggregateState, key: string): void {
    if (!state.pendingOrder.includes(key)) {
      state.pendingOrder.push(key);
    }
  }

  private schedulePersist(projectId: string, threadName: string, turnId: string, state: TurnStreamAggregateState, now: number): void {
    if (state.persistTimer) {
      return;
    }
    const delay = this.nextDelay(state.lastPersistAt, state.firstDirtyAt, now, this.persistWindowMs, this.persistMaxWaitMs);
    state.persistTimer = setTimeout(() => {
      void this.flushPersist(projectId, threadName, turnId, "timer");
    }, delay);
    log.debug({
      projectId,
      threadName,
      turnId,
      delay,
      dirtyFields: [...state.dirtyFields],
      pendingChars: state.pendingChars,
      lastPersistAt: state.lastPersistAt
    }, "stream persist scheduled");
  }

  private scheduleUi(projectId: string, threadName: string, turnId: string, state: TurnStreamAggregateState, now: number): void {
    if (state.outputTimer) {
      return;
    }
    const delay = this.nextDelay(state.lastOutputFlushAt, state.firstDirtyAt, now, this.uiWindowMs, this.uiMaxWaitMs);
    state.outputTimer = setTimeout(() => {
      void this.flushUi(projectId, threadName, turnId, "timer");
    }, delay);
    log.debug({
      projectId,
      threadName,
      turnId,
      delay,
      dirtyFields: [...state.dirtyFields],
      pendingChars: state.pendingChars,
      lastOutputFlushAt: state.lastOutputFlushAt
    }, "stream output scheduled");
  }

  private nextDelay(lastFlushAt: number | undefined, firstDirtyAt: number, now: number, windowMs: number, maxWaitMs: number): number {
    const sinceLastFlush = lastFlushAt === undefined ? windowMs : Math.max(0, windowMs - (now - lastFlushAt));
    const sinceFirstDirty = Math.max(0, maxWaitMs - (now - firstDirtyAt));
    return Math.max(0, Math.min(sinceLastFlush, sinceFirstDirty));
  }

  private async flushPersist(projectId: string, threadName: string, turnId: string, reason: string): Promise<void> {
    const state = this.states.get(this.stateKey(projectId, turnId));
    if (!state || state.dirtyFields.size === 0) {
      if (state?.persistTimer) {
        clearTimeout(state.persistTimer);
        state.persistTimer = undefined;
      }
      return;
    }
    if (state.persistInFlight) {
      await state.persistInFlight;
      return;
    }
    if (state.persistTimer) {
      clearTimeout(state.persistTimer);
      state.persistTimer = undefined;
    }
    state.persistInFlight = (async () => {
      await this.callbacks.syncTurnState(projectId, turnId, state.latestSnapshot);
      state.lastPersistAt = Date.now();
      state.persistedSequence = state.sequence;
      log.info({
        projectId,
        threadName,
        turnId,
        dirtyFields: [...state.dirtyFields],
        pendingChars: state.pendingChars,
        bufferedForMs: state.lastPersistAt - state.firstDirtyAt,
        reason
      }, "stream persist flush");
      if (state.outputSequence === state.sequence && state.pendingOrder.length === 0) {
        this.resetDirtyState(state);
      }
    })();
    try {
      await state.persistInFlight;
    } finally {
      state.persistInFlight = undefined;
    }
  }

  private async flushUi(projectId: string, threadName: string, turnId: string, reason: string): Promise<void> {
    const state = this.states.get(this.stateKey(projectId, turnId));
    if (!state || state.pendingOrder.length === 0) {
      if (state?.outputTimer) {
        clearTimeout(state.outputTimer);
        state.outputTimer = undefined;
      }
      return;
    }
    if (state.outputInFlight) {
      await state.outputInFlight;
      return;
    }
    if (state.outputTimer) {
      clearTimeout(state.outputTimer);
      state.outputTimer = undefined;
    }
    state.outputInFlight = (async () => {
      const messages = this.drainMessages(state);
      for (const message of messages) {
        await this.callbacks.routeMessage(projectId, message, { skipPersist: true });
      }

      const flushedAt = Date.now();
      log.info({
        projectId,
        threadName,
        turnId,
        messageKinds: messages.map((message) => message.kind),
        pendingChars: state.pendingChars,
        bufferedForMs: flushedAt - state.firstDirtyAt,
        reason
      }, "stream output flush");

      state.lastOutputFlushAt = flushedAt;
      state.outputSequence = state.sequence;
      this.resetOutputState(state);
      if (state.persistedSequence === state.outputSequence) {
        this.resetDirtyState(state);
      }
    })();
    try {
      await state.outputInFlight;
    } finally {
      state.outputInFlight = undefined;
    }
  }

  private drainMessages(state: TurnStreamAggregateState): IMOutputMessage[] {
    const messages: IMOutputMessage[] = [];
    for (const key of state.pendingOrder) {
      if (key === "content" && state.contentDelta) {
        messages.push({ kind: "content", turnId: state.latestSnapshot.turnId, delta: state.contentDelta });
        continue;
      }
      if (key === "reasoning" && state.reasoningDelta) {
        messages.push({ kind: "reasoning", turnId: state.latestSnapshot.turnId, delta: state.reasoningDelta });
        continue;
      }
      if (key === "plan" && state.planDelta) {
        messages.push({ kind: "plan", turnId: state.latestSnapshot.turnId, delta: state.planDelta });
        continue;
      }
      if (key.startsWith("tool_output:")) {
        const aggregated = state.toolOutputDeltas.get(key);
        if (aggregated?.delta) {
          messages.push(aggregated);
        }
      }
    }
    return messages;
  }

  private resetOutputState(state: TurnStreamAggregateState): void {
    state.pendingOrder = [];
    state.contentDelta = "";
    state.reasoningDelta = "";
    state.planDelta = "";
    state.toolOutputDeltas.clear();
    state.pendingChars = {
      content: 0,
      reasoning: 0,
      plan: 0,
      toolOutput: 0
    };
  }

  private resetDirtyState(state: TurnStreamAggregateState): void {
    state.dirtyFields.clear();
    state.firstDirtyAt = Date.now();
  }

  private totalPendingChars(state: TurnStreamAggregateState): number {
    return state.pendingChars.content + state.pendingChars.reasoning + state.pendingChars.plan + state.pendingChars.toolOutput;
  }

  private stateKey(projectId: string, turnId: string): string {
    return `${projectId}:${turnId}`;
  }
}
