import crypto from "node:crypto";

export interface SecretRecord {
  id: string;
  orgId: string;
  key: string;
  cipherText: string;
  iv: string;
  authTag: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretRepositoryPort {
  upsert(record: SecretRecord): Promise<void>;
  get(orgId: string, key: string): Promise<SecretRecord | null>;
}

function toMasterKey(input: string): Buffer {
  return crypto.createHash("sha256").update(input).digest();
}

export class SecretService {
  private readonly masterKey: Buffer;

  private readonly repo: SecretRepositoryPort;

  constructor(masterKey: string, repo: SecretRepositoryPort) {
    this.masterKey = toMasterKey(masterKey);
    this.repo = repo;
  }

  async writeSecret(orgId: string, key: string, plainText: string): Promise<void> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const now = new Date().toISOString();

    await this.repo.upsert({
      id: `${orgId}:${key}`,
      orgId,
      key,
      cipherText: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: tag.toString("base64"),
      createdAt: now,
      updatedAt: now
    });
  }

  async readSecret(orgId: string, key: string): Promise<string | null> {
    const record = await this.repo.get(orgId, key);
    if (!record) {
      return null;
    }
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.masterKey,
      Buffer.from(record.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(record.cipherText, "base64")),
      decipher.final()
    ]);
    return plain.toString("utf8");
  }
}

export class InMemorySecretRepository implements SecretRepositoryPort {
  private readonly store = new Map<string, SecretRecord>();

  async upsert(record: SecretRecord): Promise<void> {
    this.store.set(`${record.orgId}:${record.key}`, record);
  }

  async get(orgId: string, key: string): Promise<SecretRecord | null> {
    return this.store.get(`${orgId}:${key}`) ?? null;
  }
}
