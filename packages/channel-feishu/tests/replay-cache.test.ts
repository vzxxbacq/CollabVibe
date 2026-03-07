import { describe, expect, it } from "vitest";

import { ReplayCache } from "../src/replay-cache";

describe("replay cache", () => {
  it("evicts oldest items when max size is exceeded", () => {
    const cache = new ReplayCache({
      maxSize: 2,
      ttlSec: 100,
      now: () => 1000
    });

    cache.remember("evt-1");
    cache.remember("evt-2");
    cache.remember("evt-3");

    expect(cache.has("evt-1")).toBe(false);
    expect(cache.has("evt-2")).toBe(true);
    expect(cache.has("evt-3")).toBe(true);
  });

  it("expires old entries by ttl", () => {
    let now = 1000;
    const cache = new ReplayCache({
      maxSize: 10,
      ttlSec: 5,
      now: () => now
    });

    cache.remember("evt-1");
    expect(cache.has("evt-1")).toBe(true);

    now = 1006;
    expect(cache.has("evt-1")).toBe(false);
  });
});
