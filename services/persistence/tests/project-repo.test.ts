import { describe, expect, it } from "vitest";

import { ProjectRepository } from "../src/project-repository";

describe("project repository", () => {
  it("supports project CRUD-like flow", async () => {
    const repo = new ProjectRepository();

    await repo.create({
      id: "proj-1",
      orgId: "org-1",
      name: "payment-api",
      defaultCwd: "/repos/payment",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      status: "active"
    });

    await expect(repo.getById("proj-1")).resolves.toMatchObject({ name: "payment-api" });
    await expect(repo.listByOrg("org-1")).resolves.toHaveLength(1);

    await repo.updateStatus("proj-1", "disabled");
    await expect(repo.getById("proj-1")).resolves.toMatchObject({ status: "disabled" });
  });

  it("enforces unique org+name", async () => {
    const repo = new ProjectRepository();

    await repo.create({
      id: "proj-1",
      orgId: "org-1",
      name: "payment-api",
      defaultCwd: "/repos/payment",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      status: "active"
    });

    await expect(
      repo.create({
        id: "proj-2",
        orgId: "org-1",
        name: "payment-api",
        defaultCwd: "/repos/other",
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        status: "active"
      })
    ).rejects.toThrowError("project already exists");
  });

  it("rolls back writes on transaction failure", async () => {
    const repo = new ProjectRepository();

    await expect(
      repo.withTransaction(async (txRepo) => {
        await txRepo.create({
          id: "proj-1",
          orgId: "org-1",
          name: "payment-api",
          defaultCwd: "/repos/payment",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          status: "active"
        });

        await txRepo.create({
          id: "proj-2",
          orgId: "org-1",
          name: "payment-api",
          defaultCwd: "/repos/other",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          status: "active"
        });
      })
    ).rejects.toThrowError("project already exists");

    await expect(repo.listByOrg("org-1")).resolves.toEqual([]);
  });

  it("transaction rollback does not overwrite concurrent writes", async () => {
    const repo = new ProjectRepository();
    let resumeTx: (() => void) | null = null;
    const txPaused = new Promise<void>((resolve) => {
      resumeTx = resolve;
    });

    const tx = repo.withTransaction(async (txRepo) => {
      await txRepo.create({
        id: "proj-tx-1",
        orgId: "org-1",
        name: "from-tx",
        defaultCwd: "/repos/tx",
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        status: "active"
      });
      await txPaused;
      throw new Error("rollback");
    });

    await repo.create({
      id: "proj-outside-1",
      orgId: "org-2",
      name: "from-outside",
      defaultCwd: "/repos/outside",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      status: "active"
    });

    resumeTx?.();
    await expect(tx).rejects.toThrowError("rollback");
    await expect(repo.getById("proj-outside-1")).resolves.toMatchObject({ name: "from-outside" });
    await expect(repo.getById("proj-tx-1")).resolves.toBeNull();
  });

  it("transaction commit preserves concurrent external writes", async () => {
    const repo = new ProjectRepository();
    let resumeTx: (() => void) | null = null;
    const txPaused = new Promise<void>((resolve) => {
      resumeTx = resolve;
    });

    const tx = repo.withTransaction(async (txRepo) => {
      await txRepo.create({
        id: "proj-tx-commit",
        orgId: "org-1",
        name: "from-tx-commit",
        defaultCwd: "/repos/tx-commit",
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        status: "active"
      });
      await txPaused;
    });

    await repo.create({
      id: "proj-outside-commit",
      orgId: "org-2",
      name: "from-outside-commit",
      defaultCwd: "/repos/outside-commit",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      status: "active"
    });

    resumeTx?.();
    await tx;
    await expect(repo.getById("proj-outside-commit")).resolves.toMatchObject({ name: "from-outside-commit" });
    await expect(repo.getById("proj-tx-commit")).resolves.toMatchObject({ name: "from-tx-commit" });
  });
});
