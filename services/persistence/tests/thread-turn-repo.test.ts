import { describe, expect, it } from "vitest";

import { ThreadRepository, TurnRepository } from "../src/thread-turn-repository";

describe("thread and turn repositories", () => {
  it("upserts thread mapping by project+chat", async () => {
    const repo = new ThreadRepository();

    await repo.upsertByProjectChat({
      id: "t-1",
      projectId: "proj-1",
      chatId: "chat-1",
      codexThreadId: "thr-1",
      status: "active"
    });

    await expect(repo.getByProjectChat("proj-1", "chat-1")).resolves.toMatchObject({
      codexThreadId: "thr-1"
    });
  });

  it("handles turn state transitions", async () => {
    const repo = new TurnRepository();

    await repo.create({
      id: "turn-local-1",
      threadId: "t-1",
      codexTurnId: "turn-1",
      status: "running",
      startedAt: "2026-03-07T00:00:00Z"
    });

    await repo.transition("turn-local-1", "completed", "2026-03-07T00:00:03Z");

    await expect(repo.getById("turn-local-1")).resolves.toMatchObject({
      status: "completed",
      endedAt: "2026-03-07T00:00:03Z"
    });
  });

  it("rolls back thread upsert when transaction fails", async () => {
    const repo = new ThreadRepository();

    await expect(
      repo.withTransaction(async (txRepo) => {
        await txRepo.upsertByProjectChat({
          id: "t-1",
          projectId: "proj-1",
          chatId: "chat-1",
          codexThreadId: "thr-1",
          status: "active"
        });
        throw new Error("rollback");
      })
    ).rejects.toThrowError("rollback");

    await expect(repo.getByProjectChat("proj-1", "chat-1")).resolves.toBeNull();
  });

  it("rolls back turn create when transaction fails", async () => {
    const repo = new TurnRepository();

    await expect(
      repo.withTransaction(async (txRepo) => {
        await txRepo.create({
          id: "turn-local-1",
          threadId: "t-1",
          codexTurnId: "turn-1",
          status: "running",
          startedAt: "2026-03-07T00:00:00Z"
        });
        throw new Error("rollback");
      })
    ).rejects.toThrowError("rollback");

    await expect(repo.getById("turn-local-1")).resolves.toBeNull();
  });
});
