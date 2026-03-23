/**
 * Default excludes for git-utils Git operations.
 *
 * Single source of truth:
 * - the project-root `.gitignore`
 *
 * No workspace-level fallback is used.
 */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, dirname, resolve as pathResolve } from "node:path";

export function initDefaultExcludes(_workspaceCwd: string): void {
    // no-op: kept only for API compatibility
}

function resolveProjectRoot(cwd: string): string | null {
    let current = pathResolve(cwd);
    while (true) {
        const gitPath = join(current, ".git");
        if (existsSync(gitPath)) {
            const stats = lstatSync(gitPath);
            if (stats.isDirectory()) {
                return current;
            }
            if (stats.isFile()) {
                const pointer = readFileSync(gitPath, "utf-8").trim();
                const prefix = "gitdir:";
                if (pointer.startsWith(prefix)) {
                    const gitdir = pathResolve(current, pointer.slice(prefix.length).trim());
                    const gitdirParent = dirname(gitdir);
                    if (gitdirParent.endsWith("/worktrees") || gitdirParent.endsWith("\\worktrees")) {
                        return dirname(dirname(gitdirParent));
                    }
                }
                return current;
            }
        }
        const parent = dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

export function getDefaultExcludesArgs(cwd?: string): string[] {
    if (!cwd) {
        return [];
    }
    const projectRoot = resolveProjectRoot(cwd);
    const resolvedPath = projectRoot ? join(projectRoot, ".gitignore") : null;
    if (!resolvedPath || !existsSync(resolvedPath)) {
        return [];
    }
    return ["-c", `core.excludesFile=${resolvedPath}`];
}

export function resetDefaultExcludes(): void {
    // no-op
}
