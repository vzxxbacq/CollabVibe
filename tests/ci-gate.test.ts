import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

interface PackageJson {
  scripts: Record<string, string>;
}

describe("ci gate scripts", () => {
  it("has independent module test scripts", () => {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as PackageJson;

    const requiredScripts = [
      "test:workspace",
      "test:ci-gate",
      "test:channel-core",
      "test:channel-feishu",
      "test:codex-client",
      "test:orchestrator",
      "test:iam",
      "test:persistence",
      "test:e2e:phase1",
      "report:phase1"
    ];

    for (const scriptName of requiredScripts) {
      expect(packageJson.scripts[scriptName], `${scriptName} missing`).toBeTypeOf("string");
    }
  });

  it("contains shared module test helper script", () => {
    const helperPath = path.join(process.cwd(), "scripts", "test-module.sh");
    expect(fs.existsSync(helperPath)).toBe(true);
    expect(fs.statSync(helperPath).mode & 0o111).toBeGreaterThan(0);
  });

  it("registers phase2 scripts and report generator", () => {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as PackageJson;

    const requiredScripts = [
      "test:phase2:logic",
      "test:orchestrator:phase2",
      "test:approval",
      "test:audit",
      "test:admin-api",
      "test:admin-ui",
      "test:live:codex",
      "test:live:codex:precheck",
      "report:phase2"
    ];

    for (const scriptName of requiredScripts) {
      expect(packageJson.scripts[scriptName], `${scriptName} missing`).toBeTypeOf("string");
    }

    const phase2ReportScriptPath = path.join(process.cwd(), "scripts", "generate-review-report-phase2.mjs");
    expect(fs.existsSync(phase2ReportScriptPath)).toBe(true);
  });

  it("contains phase1 github actions gate workflow", () => {
    const workflowPath = path.join(process.cwd(), ".github", "workflows", "phase1-ci.yml");
    expect(fs.existsSync(workflowPath)).toBe(true);
    const content = fs.readFileSync(workflowPath, "utf-8");
    expect(content).toContain("npm run report:phase1");
  });
});
