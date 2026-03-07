import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS } from "../src/migrations";

function migrate(db: DatabaseSync): void {
  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }
}

describe("sqlite repository integration", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("persists and updates project records in sqlite", () => {
    const insertProject = db.prepare(
      `INSERT INTO projects (id, org_id, name, default_cwd, sandbox_mode, approval_policy, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    insertProject.run("proj-1", "org-1", "payment-api", "/repos/payment", "workspace-write", "on-request", "active");

    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get("proj-1") as { status: string; name: string };
    expect(project.name).toBe("payment-api");
    expect(project.status).toBe("active");

    db.prepare("UPDATE projects SET status = ? WHERE id = ?").run("disabled", "proj-1");
    const updated = db.prepare("SELECT status FROM projects WHERE id = ?").get("proj-1") as { status: string };
    expect(updated.status).toBe("disabled");

    expect(() =>
      insertProject.run("proj-2", "org-1", "payment-api", "/repos/other", "workspace-write", "on-request", "active")
    ).toThrowError(/UNIQUE constraint failed/);
  });

  it("supports thread upsert, turn transitions and transaction rollback", () => {
    db.prepare(
      `INSERT INTO threads (id, project_id, chat_id, codex_thread_id, status)
       VALUES (?, ?, ?, ?, ?)`
    ).run("thread-1", "proj-1", "chat-1", "thr-1", "active");

    db.prepare(
      `INSERT INTO threads (id, project_id, chat_id, codex_thread_id, status)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, chat_id)
       DO UPDATE SET id = excluded.id, codex_thread_id = excluded.codex_thread_id, status = excluded.status`
    ).run("thread-2", "proj-1", "chat-1", "thr-2", "active");

    const thread = db.prepare("SELECT id, codex_thread_id FROM threads WHERE project_id = ? AND chat_id = ?").get(
      "proj-1",
      "chat-1"
    ) as { id: string; codex_thread_id: string };
    expect(thread.id).toBe("thread-2");
    expect(thread.codex_thread_id).toBe("thr-2");

    db.prepare(
      `INSERT INTO turns (id, thread_id, codex_turn_id, status, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("turn-1", "thread-2", "codex-turn-1", "running", "2026-03-07T00:00:00Z", null);

    db.prepare("UPDATE turns SET status = ?, ended_at = ? WHERE id = ?").run("completed", "2026-03-07T00:00:03Z", "turn-1");
    const turn = db.prepare("SELECT status, ended_at FROM turns WHERE id = ?").get("turn-1") as {
      status: string;
      ended_at: string;
    };
    expect(turn.status).toBe("completed");
    expect(turn.ended_at).toBe("2026-03-07T00:00:03Z");

    db.exec("BEGIN TRANSACTION");
    try {
      db.prepare(
        `INSERT INTO projects (id, org_id, name, default_cwd, sandbox_mode, approval_policy, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run("proj-tx-1", "org-tx", "service", "/repos/a", "workspace-write", "on-request", "active");

      db.prepare(
        `INSERT INTO projects (id, org_id, name, default_cwd, sandbox_mode, approval_policy, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run("proj-tx-2", "org-tx", "service", "/repos/b", "workspace-write", "on-request", "active");
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
    }

    const txRows = db.prepare("SELECT COUNT(*) AS total FROM projects WHERE org_id = ?").get("org-tx") as { total: number };
    expect(txRows.total).toBe(0);
  });

  it("keeps data safe under concurrent writes for same project identity", async () => {
    const insertProject = db.prepare(
      `INSERT INTO projects (id, org_id, name, default_cwd, sandbox_mode, approval_policy, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const results = await Promise.all(
      ["proj-c-1", "proj-c-2", "proj-c-3"].map(async (id) => {
        try {
          insertProject.run(id, "org-c", "payment-api", `/repos/${id}`, "workspace-write", "on-request", "active");
          return "ok";
        } catch {
          return "failed";
        }
      })
    );

    expect(results.filter((item) => item === "ok")).toHaveLength(1);

    const count = db
      .prepare("SELECT COUNT(*) AS total FROM projects WHERE org_id = ? AND name = ?")
      .get("org-c", "payment-api") as { total: number };
    expect(count.total).toBe(1);
  });
});
