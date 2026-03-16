import { describe, expect, it } from "vitest";

import { AuditLogRepository } from "../../../src/audit-log-repository";
import { ThreadRepository, TurnRepository } from "../../../src/thread-turn-repository";

describe("tx-consistency", () => {
  it("keeps external writes when tx work fails", async () => {
    const threadRepo = new ThreadRepository();
    const turnRepo = new TurnRepository();
    const auditRepo = new AuditLogRepository();

    await threadRepo.upsertByProjectChat({
      id: "t-0",
      projectId: "p",
      chatId: "c0",
      codexThreadId: "thr-0",
      status: "active"
    });
    await turnRepo.create({
      id: "turn-0",
      threadId: "t-0",
      codexTurnId: "codex-turn-0",
      status: "running",
      startedAt: "2026-03-01T00:00:00.000Z"
    });
    await auditRepo.append({
      id: "a-0",
      projectId: "p",
      actorId: "u0",
      action: "start",
      result: "ok",
      createdAt: "2026-03-01T00:00:00.000Z"
    });

    await expect(
      threadRepo.withTransaction(async (txThread) => {
        await txThread.upsertByProjectChat({
          id: "t-1",
          projectId: "p",
          chatId: "c1",
          codexThreadId: "thr-1",
          status: "active"
        });

        await threadRepo.upsertByProjectChat({
          id: "t-external",
          projectId: "p",
          chatId: "c-external",
          codexThreadId: "thr-external",
          status: "active"
        });

        await turnRepo.withTransaction(async (txTurn) => {
          await txTurn.create({
            id: "turn-1",
            threadId: "t-1",
            codexTurnId: "codex-turn-1",
            status: "running",
            startedAt: "2026-03-01T00:00:00.000Z"
          });

          await turnRepo.create({
            id: "turn-external",
            threadId: "t-external",
            codexTurnId: "codex-turn-external",
            status: "running",
            startedAt: "2026-03-01T00:00:00.000Z"
          });

          await auditRepo.withTransaction(async (txAudit) => {
            await txAudit.append({
              id: "a-1",
              projectId: "p",
              actorId: "u1",
              action: "tx",
              result: "ok",
              createdAt: "2026-03-01T00:00:00.000Z"
            });

            await auditRepo.append({
              id: "a-external",
              projectId: "p",
              actorId: "u2",
              action: "external",
              result: "ok",
              createdAt: "2026-03-01T00:00:01.000Z"
            });
            throw new Error("rollback");
          });
        });
      })
    ).rejects.toThrowError("rollback");

    expect(await threadRepo.getByProjectChat("p", "c-external")).not.toBeNull();
    expect(await threadRepo.getByProjectChat("p", "c1")).toBeNull();
    expect(await turnRepo.getById("turn-external")).not.toBeNull();
    expect(await turnRepo.getById("turn-1")).toBeNull();
    expect((await auditRepo.listByProject("p")).map((entry) => entry.id)).toContain("a-external");
    expect((await auditRepo.listByProject("p")).map((entry) => entry.id)).not.toContain("a-1");
  });
});
