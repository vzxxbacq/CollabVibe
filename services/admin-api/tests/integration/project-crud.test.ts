import { describe, expect, it, vi } from "vitest";

import { AdminApiService } from "../../src/index";

describe("project-crud", () => {
  it("checks duplicate name/chat", async () => {
    const service = new AdminApiService({
      secretStore: {
        write: vi.fn(async () => undefined),
        read: vi.fn(async () => null)
      }
    });

    await service.createProject({
      id: "proj-1",
      name: "payment",
      chatId: "chat-1",
      cwd: "/repo/payment",
      sandbox: "workspace-write",
      approvalPolicy: "on-request"
    });
    await expect(
      service.createProject({
        id: "proj-2",
        name: "payment",
        chatId: "chat-2",
        cwd: "/repo/payment2",
        sandbox: "workspace-write",
        approvalPolicy: "on-request"
      })
    ).rejects.toThrowError("project name already exists");
    await expect(
      service.createProject({
        id: "proj-3",
        name: "billing",
        chatId: "chat-1",
        cwd: "/repo/billing",
        sandbox: "workspace-write",
        approvalPolicy: "on-request"
      })
    ).rejects.toThrowError("chat already bound");
  });

  it("lists projects and updates status", async () => {
    const service = new AdminApiService({
      secretStore: {
        write: vi.fn(async () => undefined),
        read: vi.fn(async () => null)
      }
    });

    await service.createProject({
      id: "proj-1",
      name: "payment",
      chatId: "chat-1",
      cwd: "/repo/payment",
      sandbox: "workspace-write",
      approvalPolicy: "on-request"
    });
    await service.createProject({
      id: "proj-2",
      name: "billing",
      chatId: "chat-2",
      cwd: "/repo/billing",
      sandbox: "workspace-write",
      approvalPolicy: "on-request"
    });

    expect(service.listProjects()).toHaveLength(2);
    expect(service.updateProjectStatus("proj-1", "disabled")).toMatchObject({
      id: "proj-1",
      status: "disabled"
    });
    expect(() => service.updateProjectStatus("proj-x", "disabled")).toThrowError("project not found");
  });
});
