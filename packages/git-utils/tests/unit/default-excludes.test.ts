import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("getDefaultExcludesArgs", () => {
    const originalCwd = process.cwd();
    const tempDirs: string[] = [];

    afterEach(() => {
        process.chdir(originalCwd);
        vi.resetModules();
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("seeds the system-level default.gitignore under process.cwd() instead of the worktree cwd", async () => {
        const repoRoot = mkdtempSync(join(tmpdir(), "git-utils-default-excludes-"));
        tempDirs.push(repoRoot);

        const worktreePath = join(repoRoot, "test", "cv4--m25");
        mkdirSync(worktreePath, { recursive: true });
        process.chdir(repoRoot);

        const { getDefaultExcludesArgs } = await import("../../src/default-excludes");
        const args = getDefaultExcludesArgs(worktreePath);

        const expectedConfigPath = join(repoRoot, "data", "config", "default.gitignore");
        const unexpectedWorktreePath = join(worktreePath, "data", "config", "default.gitignore");

        expect(args).toEqual(["-c", `core.excludesFile=${expectedConfigPath}`]);
        expect(existsSync(expectedConfigPath)).toBe(true);
        expect(existsSync(unexpectedWorktreePath)).toBe(false);

        const content = readFileSync(expectedConfigPath, "utf-8");
        expect(content).toContain("venv/");
        expect(content).toContain("node_modules/");
    });
});
