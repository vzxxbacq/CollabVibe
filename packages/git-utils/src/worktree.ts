/**
 * Git worktree management for thread isolation.
 *
 * Each thread gets its own working directory via `git worktree add`,
 * allowing parallel edits on different branches without file conflicts.
 */
import { access, rm, symlink, mkdir, lstat, readlink, realpath, readFile } from "node:fs/promises";
import { join, relative, dirname, resolve as pathResolve } from "node:path";
import { createLogger } from "../../logger/src/index";
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
    options?: { pluginDirs?: string[]; baseBranch?: string }
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
        const args = ["worktree", "add", worktreePath, "-b", branchName];
        if (options?.baseBranch) {
            args.push(options.baseBranch);
        }
        await git(args, mainCwd);
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
 * Assert that a worktree is valid: exists on disk AND registered in git.
 * Throws a clear error if either condition fails.
 * Call before merge preview/confirm/start-review to fail fast.
 */
export async function assertWorktreeValid(mainCwd: string, worktreePath: string): Promise<void> {
    try {
        await access(worktreePath);
    } catch {
        throw new Error(`worktree directory does not exist: ${worktreePath}`);
    }
    const { stdout } = await git(["worktree", "list", "--porcelain"], mainCwd);
    if (!stdout.includes(worktreePath)) {
        throw new Error(`worktree directory exists but is not registered in git: ${worktreePath}`);
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

/**
 * Get the HEAD commit SHA of a git directory.
 */
export async function getHeadSha(cwd: string): Promise<string> {
    const { stdout } = await git(["rev-parse", "HEAD"], cwd);
    return stdout.trim();
}

/**
 * Fast-forward a worktree to a target branch/ref.
 * Only safe when the worktree has no uncommitted changes and no diverged commits.
 * Uses `git merge --ff-only` to ensure it's a true fast-forward.
 * Returns the new HEAD SHA after the operation.
 */
export async function fastForwardWorktree(worktreePath: string, targetRef: string): Promise<string> {
    // Fetch the latest refs first (the main repo shares objects with worktrees)
    await git(["merge", "--ff-only", targetRef], worktreePath);
    return getHeadSha(worktreePath);
}


/**
 * Fast-forward a worktree only when its current HEAD still matches the expected SHA.
 * This lets callers safely update follower threads without racing a concurrent local commit.
 */
export async function fastForwardWorktreeIfHeadMatches(
    worktreePath: string,
    expectedHead: string,
    targetRef: string
): Promise<{ updated: boolean; newHead: string; reason?: string }> {
    const currentHead = await getHeadSha(worktreePath);
    if (currentHead !== expectedHead) {
        return { updated: false, newHead: currentHead, reason: `head_mismatch:${currentHead}` };
    }
    const newHead = await fastForwardWorktree(worktreePath, targetRef);
    return { updated: true, newHead };
}
