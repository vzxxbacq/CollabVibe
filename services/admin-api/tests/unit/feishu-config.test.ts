import { describe, expect, it, vi } from "vitest";

import { AdminApiService } from "../../src/index";

describe("feishu-config", () => {
  it("validates required fields and persists encrypted config", async () => {
    const write = vi.fn(async () => undefined);
    const service = new AdminApiService({
      secretStore: {
        write,
        read: vi.fn(async () => null)
      }
    });

    await expect(
      service.saveFeishuConfig("org-1", {
        appId: "",
        appSecret: "s",
        encryptKey: "k",
        signingSecret: "sig"
      })
    ).rejects.toThrowError("feishu config missing required fields");

    await service.saveFeishuConfig("org-1", {
      appId: "app-id",
      appSecret: "secret",
      encryptKey: "encrypt",
      signingSecret: "sign"
    });
    expect(write).toHaveBeenCalledTimes(4);
    expect(write).toHaveBeenCalledWith("feishu:org-1:appId", "app-id");
    expect(write).toHaveBeenCalledWith("feishu:org-1:signingSecret", "sign");
  });

  it("accepts different orgs without collisions", async () => {
    const write = vi.fn(async () => undefined);
    const service = new AdminApiService({
      secretStore: {
        write,
        read: vi.fn(async () => null)
      }
    });

    await service.saveFeishuConfig("org-1", {
      appId: "app-a",
      appSecret: "secret-a",
      encryptKey: "encrypt-a",
      signingSecret: "sign-a"
    });
    await service.saveFeishuConfig("org-2", {
      appId: "app-b",
      appSecret: "secret-b",
      encryptKey: "encrypt-b",
      signingSecret: "sign-b"
    });
    expect(write).toHaveBeenCalledWith("feishu:org-1:appId", "app-a");
    expect(write).toHaveBeenCalledWith("feishu:org-2:appId", "app-b");
  });
});
