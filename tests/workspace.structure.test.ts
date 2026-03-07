import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REQUIRED_DIRS = [
  "packages/channel-core",
  "packages/channel-feishu",
  "packages/codex-client",
  "services/orchestrator",
  "services/iam",
  "services/persistence"
];

describe("workspace structure", () => {
  it("contains phase1 module directories", () => {
    for (const dir of REQUIRED_DIRS) {
      const fullPath = path.join(process.cwd(), dir);
      expect(fs.existsSync(fullPath), `missing ${dir}`).toBe(true);
    }
  });
});
