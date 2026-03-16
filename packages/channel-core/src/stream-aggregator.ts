/**
 * StreamAggregator — 合并高频流式增量以减少卡片更新频率。
 *
 * 工作原理：按 streamKey 分桶，窗口期内累积 delta，超时或超过字符限制后 emit。
 * 支持任意包含 { delta: string } 的 chunk 类型。
 */

export interface StreamAggregationPolicy {
  windowMs: number;
  maxWaitMs: number;
  maxChars: number;
}

/** StreamAggregator 可聚合的 chunk 类型 — 必须有 delta 字段 */
export interface AggregableChunk {
  delta: string;
  [key: string]: unknown;
}

interface AggregateBucket<T extends AggregableChunk> {
  chunk: T;
  streamKey: string;
  startedAt: number;
  windowTimer: NodeJS.Timeout;
  maxWaitTimer: NodeJS.Timeout;
}

export class StreamAggregator {
  private readonly policy: StreamAggregationPolicy;

  private readonly buckets = new Map<string, AggregateBucket<AggregableChunk>>();

  constructor(policy: StreamAggregationPolicy) {
    this.policy = policy;
  }

  /**
   * Push a chunk for aggregation.
   * @param chunk  The chunk to aggregate (must have `delta`)
   * @param emit   Callback when aggregated chunk is ready
   * @param streamKey  Optional key for grouping; defaults to "default"
   */
  push<T extends AggregableChunk>(chunk: T, emit: (chunk: T) => void, streamKey = "default"): void {
    const existing = this.buckets.get(streamKey);
    if (!existing) {
      const bucket: AggregateBucket<T> = {
        chunk: { ...chunk },
        streamKey,
        startedAt: Date.now(),
        windowTimer: setTimeout(() => this.flush(streamKey, emit as (chunk: AggregableChunk) => void), this.policy.windowMs),
        maxWaitTimer: setTimeout(() => this.flush(streamKey, emit as (chunk: AggregableChunk) => void), this.policy.maxWaitMs)
      };
      this.buckets.set(streamKey, bucket as AggregateBucket<AggregableChunk>);
      return;
    }

    existing.chunk.delta += chunk.delta;
    clearTimeout(existing.windowTimer);
    existing.windowTimer = setTimeout(() => this.flush(streamKey, emit as (chunk: AggregableChunk) => void), this.policy.windowMs);
    if (existing.chunk.delta.length >= this.policy.maxChars) {
      this.flush(streamKey, emit as (chunk: AggregableChunk) => void);
    }
  }

  flush(streamKey: string, emit: (chunk: AggregableChunk) => void): void {
    const bucket = this.buckets.get(streamKey);
    if (!bucket) {
      return;
    }
    clearTimeout(bucket.windowTimer);
    clearTimeout(bucket.maxWaitTimer);
    this.buckets.delete(streamKey);
    emit(bucket.chunk);
  }

  flushAll(emit: (chunk: AggregableChunk) => void): void {
    for (const streamKey of [...this.buckets.keys()]) {
      this.flush(streamKey, emit);
    }
  }
}
