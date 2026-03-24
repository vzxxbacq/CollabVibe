import { createLogger } from "../../packages/logger/src/index";

type DispatchTask = () => Promise<void>;

const log = createLogger("platform-delivery");

export class CardDispatchCoordinator {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly idleWaiters = new Set<() => void>();

  enqueue(cardKey: string, task: DispatchTask): void {
    const enqueuedAt = Date.now();
    const previous = this.chains.get(cardKey) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        log.debug({ cardKey, queuedForMs: Date.now() - enqueuedAt }, "platform delivery task started");
        await task();
        log.debug({ cardKey, totalLatencyMs: Date.now() - enqueuedAt }, "platform delivery task completed");
      })
      .catch((error) => {
        log.warn({
          cardKey,
          totalLatencyMs: Date.now() - enqueuedAt,
          err: error instanceof Error ? error.message : String(error),
        }, "platform delivery task failed");
      })
      .finally(() => {
        if (this.chains.get(cardKey) === next) {
          this.chains.delete(cardKey);
        }
        this.notifyIdleIfNeeded();
      });
    this.chains.set(cardKey, next);
  }

  async waitForIdle(): Promise<void> {
    if (this.chains.size === 0) {
      return;
    }
    await new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.chains.values()]);
    await this.waitForIdle();
  }

  private notifyIdleIfNeeded(): void {
    if (this.chains.size !== 0) {
      return;
    }
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();
    for (const resolve of waiters) {
      resolve();
    }
  }
}
