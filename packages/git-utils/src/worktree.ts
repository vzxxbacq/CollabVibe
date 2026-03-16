/**
 * Git worktree management for thread isolation.
 *
 * Each thread gets its own working directory via `git worktree add`,
 * allowing parallel edits on different branches without file conflicts.
 */
import { access, rm, symlink, mkdir, lstat, readlink, realpath, readFile } from "node:fs/promises";
import { join, relative, dirname, resolve as pathResolve } from "node:path";
import { createLogger } from "../../channel-core/src/index";
import { git } from "./git-exec";

const log = createLogger("worktree");

async function cleanupStaleManagedWorktree(mainCwd: string, worktreePath: string): Promise<boolean> {
    const gitPointerPath = join(worktreePath, ".git");
    let pointerContent: string;
    try {
        pointerContent = await readFile(gitPointerPath, "utf-8");
    } catch {
        return false;
    }

    const prefix = "gitdir:";
    if (!pointerContent.startsWith(prefix)) {
        return false;
    }

    const gitdir = pointerContent.slice(prefix.length).trim();
    const resolvedGitdir = pathResolve(worktreePath, gitdir);
    const managedRoot = pathResolve(mainCwd, ".git", "worktrees");
    if (!resolvedGitdir.startsWith(`${managedRoot}/`) && resolvedGitdir !== managedRoot) {
        return false;
    }

    try {
        await access(resolvedGitdir);
        return false;
    } catch {
        await rm(worktreePath, { recursive: true, force: true });
        await git(["worktree", "prune"], mainCwd);
        log.warn({ mainCwd, worktreePath, resolvedGitdir }, "removed stale managed worktree directory");
        return true;
    }
}

/**
 * Create a git worktree for a thread.
 */
export async function createWorktree(
    mainCwd: string,
    branchName: string,
    worktreePath: string,
    options?: { pluginDirs?: string[] }
): Promise<string> {
    try {
        await access(worktreePath);
        const { stdout } = await git(["worktree", "list", "--porcelain"], mainCwd);
        if (stdout.includes(worktreePath)) {
            if (options?.pluginDirs) {
                for (const dir of options.pluginDirs) {
                    await ensurePluginSymlink(mainCwd, worktreePath, dir);
                }
            }
            return worktreePath;
        }
        throw new Error(`worktree path already exists but is not registered: ${worktreePath}`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
        }
    }

    try {
        await git(["worktree", "add", worktreePath, "-b", branchName], mainCwd);
    } catch {
        await git(["worktree", "add", worktreePath, branchName], mainCwd);
    }

    if (options?.pluginDirs) {
        for (const dir of options.pluginDirs) {
            await ensurePluginSymlink(mainCwd, worktreePath, dir);
        }
    }

    return worktreePath;
}

/**
 * Create a symlink from worktree's skill dir → main repo's skill dir.
 */
export async function ensurePluginSymlink(
    mainCwd: string,
    worktreePath: string,
    pluginDir: string
): Promise<void> {
    const mainPluginsPath = join(mainCwd, pluginDir);
    const worktreePluginsPath = join(worktreePath, pluginDir);
    const desiredRealPath = await realpath(mainPluginsPath).catch(() => pathResolve(mainPluginsPath));

    try {
        await access(mainPluginsPath);
    } catch {
        return;
    }

    try {
        const existingRealPath = await realpath(worktreePluginsPath).catch(() => null);
        if (existingRealPath === desiredRealPath) {
            return;
        }
        const stats = await lstat(worktreePluginsPath);
        if (stats.isSymbolicLink()) {
            const target = await readlink(worktreePluginsPath);
            const resolvedTarget = pathResolve(dirname(worktreePluginsPath), target);
            if (resolvedTarget === pathResolve(mainPluginsPath)) {
                return;
            }
        }
        await rm(worktreePluginsPath, { recursive: true, force: true });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    await mkdir(dirname(worktreePluginsPath), { recursive: true });
    const relPath = relative(dirname(worktreePluginsPath), mainPluginsPath);
    try {
        await symlink(relPath, worktreePluginsPath, "dir");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
            throw err;
        }
        const existingRealPath = await realpath(worktreePluginsPath).catch(() => null);
        if (existingRealPath !== desiredRealPath) {
            throw err;
        }
    }
}

/**
 * Remove a git worktree and optionally delete the branch.
 */
export async function removeWorktree(
    mainCwd: string,
    worktreePath: string,
    deleteBranch?: string
): Promise<void> {
    try {
        await git(["worktree", "remove", "--force", worktreePath], mainCwd);
    } catch (error) {
        const cleaned = await cleanupStaleManagedWorktree(mainCwd, worktreePath);
        if (!cleaned) {
            throw error;
        }
    }
    await git(["worktree", "prune"], mainCwd);
    if (deleteBranch) {
        try {
            await git(["branch", "-D", deleteBranch], mainCwd);
        } catch {
            // Branch may not exist or is checked out elsewhere
        }
    }
}

/**
 * List all worktrees for a repository.
 */
export async function listWorktrees(
    mainCwd: string
): Promise<Array<{ path: string; branch: string; head: string }>> {
    const { stdout } = await git(["worktree", "list", "--porcelain"], mainCwd);
    const entries: Array<{ path: string; branch: string; head: string }> = [];
    let current: { path: string; branch: string; head: string } = { path: "", branch: "", head: "" };

    for (const line of stdout.split("\n")) {
        if (line.startsWith("worktree ")) {
            if (current.path) entries.push(current);
            current = { path: line.slice(9), branch: "", head: "" };
        } else if (line.startsWith("HEAD ")) {
            current.head = line.slice(5);
        } else if (line.startsWith("branch ")) {
            current.branch = line.slice(7).replace("refs/heads/", "");
        }
    }
    if (current.path) entries.push(current);
    return entries;
}

/**
 * Compute the worktree path for a given thread name.
 */
export function getWorktreePath(mainCwd: string, threadName: string): string {
    return `${mainCwd}--${threadName}`;
}
