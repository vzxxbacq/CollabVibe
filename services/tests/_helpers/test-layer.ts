import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createOrchestratorLayer, type OrchestratorConfig, type OrchestratorLayer } from "../../index";
import { createGitOps, type GitOps } from "../../../packages/git-utils/src/index";
import type { AgentApiFactory } from "../../../packages/agent-core/src/index";

export interface TestLayerHarness {
  root: string;
  workspaceRoot: string;
  layer: OrchestratorLayer;
  gitOps: any;
}

export async function createTestLayerHarness(
  sysAdmins: string[] = ["admin-user"],
  options?: {
    transportFactories?: Record<string, AgentApiFactory>;
    gitOps?: GitOps;
  },
): Promise<TestLayerHarness> {
  const root = await mkdtemp(join(tmpdir(), "collabvibe-test-"));
  const workspaceRoot = join(root, "workspace");
  const dataDir = join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  process.env.COLLABVIBE_WORKSPACE_CWD = root;
  process.env.VITEST = process.env.VITEST ?? "1";

  const gitOps = options?.gitOps ?? createGitOps(root);
  const config: OrchestratorConfig = {
    cwd: workspaceRoot,
    dataDir,
    sandbox: "workspace-write",
    approvalPolicy: "never",
    server: {
      port: 0,
      approvalTimeoutMs: 5_000,
      sysAdminUserIds: sysAdmins,
    },
  };

  const layer = await createOrchestratorLayer({
    config,
    transportFactories: options?.transportFactories,
    gitOps,
  });

  return { root, workspaceRoot, layer, gitOps };
}

export async function destroyTestLayerHarness(
  harness: TestLayerHarness,
  originalWorkspaceCwd?: string,
): Promise<void> {
  await harness.layer.shutdown();
  if (originalWorkspaceCwd === undefined) {
    delete process.env.COLLABVIBE_WORKSPACE_CWD;
  } else {
    process.env.COLLABVIBE_WORKSPACE_CWD = originalWorkspaceCwd;
  }
  await rm(harness.root, { recursive: true, force: true });
}

export async function createLocalSkillFixture(root: string, skillName: string): Promise<string> {
  const skillRoot = join(root, ".fixtures", skillName);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), `---
name: ${skillName}
description: test fixture
---

# ${skillName}

fixture skill
`, "utf8");
  return skillRoot;
}
