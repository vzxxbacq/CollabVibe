import { describe, expect, it, vi } from "vitest";

import { AdminApiService } from "../../src/index";

describe("wizard-connectivity", () => {
  it("returns connectivity error details and caches result for short ttl", async () => {
    const service = new AdminApiService({
      secretStore: {
        write: vi.fn(async () => undefined),
        read: vi.fn(async () => null)
      }
    });

    const probe = vi
      .fn<() => Promise<{ ok: boolean; detail: string }>>()
      .mockResolvedValueOnce({ ok: false, detail: "Codex init timeout" })
      .mockResolvedValueOnce({ ok: true, detail: "ok" });

    const first = await service.checkConnectivity("chat-1", probe, 1_000);
    const second = await service.checkConnectivity("chat-1", probe, 1_000);

    expect(first).toEqual({ ok: false, detail: "Codex init timeout", cached: false });
    expect(second).toEqual({ ok: false, detail: "Codex init timeout", cached: true });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("re-runs probe after cache expiry", async () => {
    vi.useFakeTimers();
    const service = new AdminApiService({
      secretStore: {
        write: vi.fn(async () => undefined),
        read: vi.fn(async () => null)
      }
    });

    const probe = vi
      .fn<() => Promise<{ ok: boolean; detail: string }>>()
      .mockResolvedValueOnce({ ok: false, detail: "first" })
      .mockResolvedValueOnce({ ok: true, detail: "second" });

    const first = await service.checkConnectivity("chat-1", probe, 100);
    vi.advanceTimersByTime(150);
    const second = await service.checkConnectivity("chat-1", probe, 100);

    expect(first).toEqual({ ok: false, detail: "first", cached: false });
    expect(second).toEqual({ ok: true, detail: "second", cached: false });
    expect(probe).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
