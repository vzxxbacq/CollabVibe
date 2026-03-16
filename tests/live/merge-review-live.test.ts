import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { spawnStdioRpcTransport } from "../../packages/agent-core/src/stdio-transport";
import { JsonRpcClient } from "../../packages/agent-core/src/rpc-client";
import { codexNotificationToUnifiedEvent } from "../../packages/codex-client/src/codex-event-bridge";
import { buildSingleFileMergeAgentPrompt } from "../../services/orchestrator/src/use-cases/merge-agent-prompt";
// scripts/live-env.mjs is plain ESM without bundled type declarations.
// @ts-expect-error local test helper module
import { getLiveCodexCommand } from "../../scripts/live-env.mjs";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function createConflictWorkspace(): Promise<{ repo: string; targetFile: string; untouchedFile: string; }> {
  const repo = await mkdtemp(join(tmpdir(), "live-merge-review-"));
  const targetFile = "generate_checkerboard.py";
  const untouchedFile = "untouched.txt";

  git(repo, ["init", "-b", "master"]);
  git(repo, ["config", "user.email", "codex@example.com"]);
  git(repo, ["config", "user.name", "Codex"]);
  await writeFile(join(repo, targetFile), [
    '"""Generate ASCII checkerboards for CLI usage.',
    "",
    "Requirements:",
    "- Keep the public function generate_checkerboard(width, height, light='.', dark='#').",
    "- Reject non-positive width/height with ValueError.",
    "- When run as a script, print an 8x8 checkerboard.",
    '"""',
    "",
    "<<<<<<< HEAD",
    "def generate_checkerboard(width: int, height: int, light: str = '.', dark: str = '#') -> str:",
    "    if width <= 0 or height <= 0:",
    "        raise ValueError('width and height must be positive')",
    "    rows = []",
    "    for y in range(height):",
    "        rows.append(''.join(light if (x + y) % 2 == 0 else dark for x in range(width)))",
    "    return '\\n'.join(rows)",
    "=======",
    "def generate_checkerboard(width: int, height: int, light: str = '.', dark: str = '#') -> str:",
    "    rows = []",
    "    for y in range(height):",
    "        row_chars = []",
    "        for x in range(width):",
    "            row_chars.append(light if (x + y) % 2 == 0 else dark)",
    "        rows.append(''.join(row_chars))",
    "    return '\\n'.join(rows)",
    "",
    "def main() -> None:",
    "    print(generate_checkerboard(8, 8))",
    ">>>>>>> master",
    "",
    "if __name__ == '__main__':",
    "    main()",
    ""
  ].join("\n"), "utf8");
  await writeFile(join(repo, untouchedFile), "must stay unchanged\n", "utf8");
  git(repo, ["add", targetFile, untouchedFile]);
  git(repo, ["commit", "-m", "seed fake conflict file"]);
  await writeFile(join(repo, targetFile), [
    "<<<<<<< HEAD",
    "print('feature')",
    "=======",
    "print('master')",
    ">>>>>>> master",
    ""
  ].join("\n"), "utf8");
  return { repo, targetFile, untouchedFile };
}

async function waitForTurnCompletion(command: string, cwd: string, prompt: string): Promise<void> {
  const transport = spawnStdioRpcTransport(command);
  const rpc = new JsonRpcClient(transport);

  try {
    await rpc.initialize({
      clientInfo: { name: "merge-live-test", title: "merge-live-test", version: "0.1.0" }
    });

    const turnDone = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("live merge review turn timed out")), 180_000);
      transport.onNotification((notification) => {
        const event = codexNotificationToUnifiedEvent(notification);
        if (!event) {
          return;
        }
        if (event.type === "turn_complete") {
          clearTimeout(timer);
          resolve();
        }
        if (event.type === "turn_aborted") {
          clearTimeout(timer);
          reject(new Error("live merge review turn aborted"));
        }
      });
    });

    const thread = await rpc.call<{ thread: { id: string } }>("thread/start", {
      cwd,
      model: "gpt-5-codex",
      approvalPolicy: "never",
      sandbox: "workspace-write"
    }, 30_000);

    await rpc.call("turn/start", {
      threadId: thread.thread.id,
      input: [{ type: "text", text: prompt }]
    }, 30_000);

    await turnDone;
  } finally {
    transport.close();
  }
}

const command = getLiveCodexCommand(process.env);
const shouldRun = Boolean(command && process.env.RUN_LIVE_MERGE_TEST === "1");
const describeIf = shouldRun ? describe : describe.skip;

describeIf("merge-review live", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      await rm(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("uses a real agent call to resolve only the target conflict file", { timeout: 240_000 }, async () => {
    const fixture = await createConflictWorkspace();
    tempDirs.push(fixture.repo);
    const prompt = await buildSingleFileMergeAgentPrompt({
      worktreeCwd: fixture.repo,
      filePath: fixture.targetFile,
      userPrompt: "Keep the validation from one side and the CLI entry point from the other side. The merged file must still expose generate_checkerboard(width, height, light='.', dark='#').",
    });

    await waitForTurnCompletion(command!, fixture.repo, prompt);

    const targetContent = await readFile(join(fixture.repo, fixture.targetFile), "utf8");
    const untouchedContent = await readFile(join(fixture.repo, fixture.untouchedFile), "utf8");

    expect(targetContent).not.toContain("<<<<<<<");
    expect(targetContent).not.toContain(">>>>>>>");
    expect(targetContent).toContain("def main()");
    expect(targetContent).toContain("raise ValueError");
    expect(untouchedContent).toBe("must stay unchanged\n");

    const checkerboardOutput = execFileSync("python3", [
      "-c",
      [
        "import importlib.util",
        `spec = importlib.util.spec_from_file_location('checkerboard', ${JSON.stringify(join(fixture.repo, fixture.targetFile))})`,
        "mod = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(mod)",
        "print(mod.generate_checkerboard(4, 3))",
      ].join("; ")
    ], { encoding: "utf8" }).trim();
    expect(checkerboardOutput).toBe(".#.#\n#.#.\n.#.#");

    const validationOutput = execFileSync("python3", [
      "-c",
      [
        "import importlib.util",
        `spec = importlib.util.spec_from_file_location('checkerboard', ${JSON.stringify(join(fixture.repo, fixture.targetFile))})`,
        "mod = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(mod)",
        "try:",
        "    mod.generate_checkerboard(0, 2)",
        "except ValueError:",
        "    print('value-error')",
        "else:",
        "    print('missing-validation')",
      ].join("\n")
    ], { encoding: "utf8" }).trim();
    expect(validationOutput).toBe("value-error");
  });
});
