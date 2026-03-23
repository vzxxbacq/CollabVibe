export interface StreamAggregationPolicy {
  windowMs: number;
  maxWaitMs: number;
  maxChars: number;
}

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
  private readonly buckets = new Map<string, AggregateBucket<AggregableChunk>>();

  constructor(private readonly policy: StreamAggregationPolicy) {}

  push<T extends AggregableChunk>(chunk: T, emit: (chunk: T) => void, streamKey = "default"): void {
    const existing = this.buckets.get(streamKey);
    if (!existing) {
      const bucket: AggregateBucket<T> = {
        chunk: { ...chunk },
        streamKey,
        startedAt: Date.now(),
        windowTimer: setTimeout(() => this.flush(streamKey, emit as (chunk: AggregableChunk) => void), this.policy.windowMs),
        maxWaitTimer: setTimeout(() => this.flush(streamKey, emit as (chunk: AggregableChunk) => void), this.policy.maxWaitMs),
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
    if (!bucket) return;
    clearTimeout(bucket.windowTimer);
    clearTimeout(bucket.maxWaitTimer);
    this.buckets.delete(streamKey);
    emit(bucket.chunk);
  }
}
