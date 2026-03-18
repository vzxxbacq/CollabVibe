import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { createBackendIdentity } from "../../../../packages/agent-core/src/backend-identity";
import { createLogger } from "../../../../packages/channel-core/src/index";
import { createWorktree } from "../../../../packages/git-utils/src/worktree";
import { MergeUseCase } from "../../src/use-cases/merge";
import type { OrchestratorContext } from "../../src/orchestrator-context";
import type { IMOutputMessage } from "../../../../packages/channel-core/src/im-output";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function createConflictRepo(): Promise<{ repo: string; worktree: string; branchName: string; conflictFile: string; extraFile: string; }> {
  const repo = await mkdtemp(join(tmpdir(), "merge-review-"));
  const branchName = "feature";
  const conflictFile = "generate_checkerboard.py";
  const extraFile = "base-only.txt";

  git(repo, ["init", "-b", "master"]);
  git(repo, ["config", "user.email", "codex@example.com"]);
  git(repo, ["config", "user.name", "Codex"]);
  git(repo, ["commit", "--allow-empty", "-m", "root"]);

  git(repo, ["checkout", "-b", branchName]);
  await writeFile(join(repo, conflictFile), "print('feature')\n", "utf8");
  git(repo, ["add", conflictFile]);
  git(repo, ["commit", "-m", "feature adds conflict file"]);

  git(repo, ["checkout", "master"]);
  await writeFile(join(repo, conflictFile), "print('master')\n", "utf8");
  await writeFile(join(repo, extraFile), "from master\n", "utf8");
  git(repo, ["add", conflictFile, extraFile]);
  git(repo, ["commit", "-m", "master adds conflict file and extra file"]);

  const worktree = `${repo}--${branchName}`;
  await createWorktree(repo, branchName, worktree);
  return { repo, worktree, branchName, conflictFile, extraFile };
}

function makeContext(input: {
  repo: string;
  branchName: string;
  routeMessages: IMOutputMessage[];
  agentApi?: {
    threadStart?: (params: { cwd?: string }) => Promise<{ thread: { id: string } }>;
    turnStart: (params: { threadId: string; input: Array<{ type: string; text: string }> }) => Promise<{ turn: { id: string } }>;
  };
}): OrchestratorContext {
  const defaultAgentApi = {
    threadStart: vi.fn(async () => ({ thread: { id: "resolver-thread-1" } })),
    turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
  };
  const agentApi = {
    ...defaultAgentApi,
    ...(input.agentApi ?? {})
  };
  return {
    log: createLogger("merge-review-test"),
    agentApiPool: {
      get: vi.fn(() => agentApi),
    } as never,
    runtimeConfigProvider: {
      getProjectRuntimeConfig: vi.fn(async () => ({
        backend: createBackendIdentity("codex", "gpt-5-codex"),
        cwd: input.repo,
        baseBranch: "master",
        sandbox: "workspace-write",
        approvalPolicy: "never",
      }))
    },
    turnState: {} as never,
    sessionStateMachines: new Map(),
    sessionApprovalWaitManagers: new Map(),
    approvalTimeoutMs: 1_000,
    toProjectThreadKey: (chatId: string, threadName: string) => `${chatId}:${threadName}`,
    resolveProjectId: () => "proj-1",
    resolveThreadName: vi.fn(async () => input.branchName),
    resolveAgentApi: vi.fn(async () => agentApi as never),
    getSessionStateMachine: vi.fn(() => ({} as never)),
    getApprovalWaitManager: vi.fn(() => ({} as never)),
    ensureCanStartTurn: vi.fn(),
    finishSessionTurn: vi.fn(),
    createThread: vi.fn(async () => ({
      threadId: "resolver-thread-1",
      threadName: `${input.branchName}-resolver`,
      cwd: input.repo,
      api: agentApi as never,
    })),
    getThreadRecord: vi.fn(() => ({ threadId: "thread-1" }) as never),
    markThreadMerged: vi.fn(),
    routeMessage: vi.fn(async (_chatId: string, message: IMOutputMessage) => {
      input.routeMessages.push(message);
    }),
    registerApprovalRequest: vi.fn(),
  };
}

describe("merge-review flow", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await rm(dir, { recursive: true, force: true });
      await rm(`${dir}--feature`, { recursive: true, force: true });
    }
  });

  it("starts with the conflict file and does not auto-complete unresolved conflicts", async () => {
    const fixture = await createConflictRepo();
    tempDirs.push(fixture.repo);
    const routeMessages: IMOutputMessage[] = [];
    const useCase = new MergeUseCase(makeContext({ repo: fixture.repo, branchName: fixture.branchName, routeMessages }));

    const review = await useCase.startMergeReview("chat-1", fixture.branchName);
    expect(review.kind).toBe("file_merge_review");
    expect(review.file.path).toBe(fixture.conflictFile);
    expect(review.file.status).toBe("conflict");

    const next = await useCase.acceptAllRemaining("chat-1", fixture.branchName);
    expect(next.kind).toBe("file_merge_review");
    if (next.kind !== "file_merge_review") {
      throw new Error("expected file_merge_review");
    }
    expect(next.file.path).toBe(fixture.conflictFile);
    expect(next.file.status).toBe("conflict");
  });

  it("blocks commit while unresolved conflicts or pending files remain", async () => {
    const fixture = await createConflictRepo();
    tempDirs.push(fixture.repo);
    const routeMessages: IMOutputMessage[] = [];
    const useCase = new MergeUseCase(makeContext({ repo: fixture.repo, branchName: fixture.branchName, routeMessages }));

    await useCase.startMergeReview("chat-1", fixture.branchName);

    await expect(useCase.commitMergeReview("chat-1", fixture.branchName))
      .rejects
      .toThrow(/未决文件|冲突文件|未解决冲突/);
  });

  it("rejects accept when git still marks the target file unresolved", async () => {
    const fixture = await createConflictRepo();
    tempDirs.push(fixture.repo);
    const routeMessages: IMOutputMessage[] = [];
    const useCase = new MergeUseCase(makeContext({ repo: fixture.repo, branchName: fixture.branchName, routeMessages }));

    await useCase.startMergeReview("chat-1", fixture.branchName);
    const session = useCase.getMergeSession("chat-1", fixture.branchName) as any;
    session.files[0].status = "agent_resolved";

    await expect(useCase.decideFile("chat-1", fixture.branchName, fixture.conflictFile, "accept"))
      .rejects
      .toThrow(/未解决冲突|无法 accept/);
  });

  it("marks agent retry invalid when it changes files outside the target", async () => {
    const fixture = await createConflictRepo();
    tempDirs.push(fixture.repo);
    const routeMessages: IMOutputMessage[] = [];
    const agentApi = {
      turnStart: vi.fn(async () => {
        await writeFile(join(fixture.worktree, fixture.conflictFile), "print('resolved by agent')\n", "utf8");
        await writeFile(join(fixture.worktree, fixture.extraFile), "modified unexpectedly\n", "utf8");
        git(fixture.worktree, ["add", fixture.conflictFile, fixture.extraFile]);
        return { turn: { id: "turn-retry-1" } };
      })
    };
    const useCase = new MergeUseCase(makeContext({ repo: fixture.repo, branchName: fixture.branchName, routeMessages, agentApi }));

    await useCase.startMergeReview("chat-1", fixture.branchName);
    await useCase.retryFileWithAgent("chat-1", fixture.branchName, fixture.conflictFile, "keep both sides");
    await useCase.onMergeFileRetryDone("chat-1", fixture.branchName, fixture.conflictFile);

    const warning = routeMessages.find((message) => message.kind === "notification");
    expect(warning).toBeTruthy();
    expect(warning?.kind).toBe("notification");
    if (warning?.kind !== "notification") {
      throw new Error("expected notification");
    }
    expect(String(warning.detail ?? "")).toContain("outside target file");

    const finalReview = routeMessages.at(-1);
    expect(finalReview?.kind).toBe("merge_review");
    if (finalReview?.kind !== "merge_review") {
      throw new Error("expected merge_review");
    }
    expect(finalReview.review.file.path).toBe(fixture.conflictFile);
    expect(finalReview.review.file.status).toBe("conflict");
  });
});
