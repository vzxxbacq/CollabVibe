import { describe, expect, it } from "vitest";

import { InMemorySecretRepository, SecretService } from "../../../src/secret-service";

describe("secrets", () => {
  it("encrypts at rest and decrypts on read", async () => {
    const repo = new InMemorySecretRepository();
    const service = new SecretService("phase2-master-key", repo);

    await service.writeSecret("org-1", "feishu.appSecret", "plain-secret-value");
    const record = await repo.get("org-1", "feishu.appSecret");
    expect(record).not.toBeNull();
    expect(record?.cipherText).not.toContain("plain-secret-value");

    const plain = await service.readSecret("org-1", "feishu.appSecret");
    expect(plain).toBe("plain-secret-value");
  });
});
