interface ReplayCacheOptions {
  maxSize?: number;
  ttlSec?: number;
  now?: () => number;
}

export class ReplayCache {
  private readonly seen = new Map<string, number>();

  private readonly maxSize: number;

  private readonly ttlSec: number;

  private readonly now: () => number;

  constructor(options: ReplayCacheOptions = {}) {
    this.maxSize = Math.max(1, options.maxSize ?? 5000);
    this.ttlSec = Math.max(1, options.ttlSec ?? 300);
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  has(eventId: string): boolean {
    this.evictExpired(this.now());
    return this.seen.has(eventId);
  }

  remember(eventId: string): void {
    const now = this.now();
    this.evictExpired(now);

    if (this.seen.has(eventId)) {
      this.seen.delete(eventId);
    }
    this.seen.set(eventId, now + this.ttlSec);

    while (this.seen.size > this.maxSize) {
      const oldestKey = this.seen.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.seen.delete(oldestKey);
    }
  }

  private evictExpired(now: number): void {
    for (const [eventId, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) {
        this.seen.delete(eventId);
      }
    }
  }
}
