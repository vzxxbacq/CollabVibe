import { describe, expect, it, vi } from "vitest";

import { AdminApiService, InMemoryAdminStateStore } from "../../src/index";

function makeDeps() {
  return {
    secretStore: {
      write: vi.fn(async () => undefined),
      read: vi.fn(async () => null)
    }
  };
}

describe("admin state store", () => {
  it("persists wizard/project/member state across service instances", async () => {
    const store = new InMemoryAdminStateStore();
    const deps = makeDeps();

    const serviceA = new AdminApiService({
      ...deps,
      stateStore: store
    });
    serviceA.submitWizardStep("org-1", 1);
    await serviceA.createProject({
      id: "proj-1",
      name: "payment",
      chatId: "chat-1",
      cwd: "/repo/payment",
      sandbox: "workspace-write",
      approvalPolicy: "on-request"
    });
    serviceA.inviteMember("proj-1", "maintainer", {
      userId: "u-1",
      role: "developer"
    });

    const serviceB = new AdminApiService({
      ...makeDeps(),
      stateStore: store
    });

    expect(serviceB.getWizardStep("org-1")).toBe(2);
    expect(serviceB.listProjects()).toHaveLength(1);
    expect(serviceB.listMembers("proj-1")).toEqual([{ userId: "u-1", role: "developer" }]);
  });
});
