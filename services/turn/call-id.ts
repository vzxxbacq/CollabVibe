import { createHash } from "node:crypto";

export function buildTurnCallId(input: {
  platform: string;
  projectId: string;
  messageId: string;
}): string {
  const hash = createHash("sha256");
  hash.update(input.platform);
  hash.update("\0");
  hash.update(input.projectId);
  hash.update("\0");
  hash.update(input.messageId);
  return hash.digest("hex");
}
