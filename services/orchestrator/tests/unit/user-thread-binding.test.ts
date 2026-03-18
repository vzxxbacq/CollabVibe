import { describe, expect, it } from "vitest";

import { UserThreadBindingService } from "../../src/index";

describe("user-thread-binding", () => {
  it("requires explicit thread selection and supports bind/resolve/leave", async () => {
    const service = new UserThreadBindingService();
    expect(await service.resolve("proj-1", "u1")).toBeNull();

    await service.bind({
      projectId: "proj-1",
      userId: "u1",
      threadName: "fix-retry",
      threadId: "thr-1",
    });
    await service.bind({
      projectId: "proj-1",
      userId: "u2",
      threadName: "docs",
      threadId: "thr-2",
    });

    expect((await service.resolve("proj-1", "u1"))?.threadName).toBe("fix-retry");
    expect((await service.resolve("proj-1", "u2"))?.threadId).toBe("thr-2");

    await service.leave("proj-1", "u1");
    expect(await service.resolve("proj-1", "u1")).toBeNull();
  });

  it("is in-memory — state lost on service re-creation", async () => {
    const serviceA = new UserThreadBindingService();
    await serviceA.bind({
      projectId: "proj-1",
      userId: "u1",
      threadName: "fix-retry",
      threadId: "thr-1",
    });

    // New service instance = fresh in-memory state
    const serviceB = new UserThreadBindingService();
    expect(await serviceB.resolve("proj-1", "u1")).toBeNull();
  });
});
