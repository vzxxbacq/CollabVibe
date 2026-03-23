import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("getDefaultExcludesArgs", () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        vi.resetModules();
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("seeds default.gitignore under the provided workspaceCwd", async () => {
        const workspaceCwd = mkdtempSync(join(tmpdir(), "git-utils-default-excludes-"));
        tempDirs.push(workspaceCwd);

        const { initDefaultExcludes, getDefaultExcludesArgs, resetDefaultExcludes } = await import("../../src/default-excludes");
        resetDefaultExcludes();
        initDefaultExcludes(workspaceCwd);
        const args = getDefaultExcludesArgs();

        const expectedConfigPath = join(workspaceCwd, "data", "config", "default.gitignore");

        expect(args).toEqual(["-c", `core.excludesFile=${expectedConfigPath}`]);
        expect(existsSync(expectedConfigPath)).toBe(true);

        const content = readFileSync(expectedConfigPath, "utf-8");
        expect(content).toContain("venv/");
        expect(content).toContain("node_modules/");

        resetDefaultExcludes();
    });

    it("throws if called before initDefaultExcludes", async () => {
        const { getDefaultExcludesArgs, resetDefaultExcludes } = await import("../../src/default-excludes");
        resetDefaultExcludes();
        expect(() => getDefaultExcludesArgs()).toThrow(/initDefaultExcludes/);
    });
});
