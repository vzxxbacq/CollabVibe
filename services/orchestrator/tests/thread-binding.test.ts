import { describe, expect, it } from "vitest";

import { ThreadBindingService } from "../src/thread-binding-service";
import { MemoryBindingRepository } from "./fixtures/memory-binding-repo";

describe("thread binding service", () => {
  it("creates and removes chat-thread mappings", async () => {
    const repo = new MemoryBindingRepository();
    const service = new ThreadBindingService(repo);

    await service.bind("proj-1", "chat-1", "thr-1");
    await expect(service.get("proj-1", "chat-1")).resolves.toEqual({
      projectId: "proj-1",
      chatId: "chat-1",
      threadId: "thr-1"
    });

    await service.unbind("proj-1", "chat-1");
    await expect(service.get("proj-1", "chat-1")).resolves.toBeNull();
  });
});
