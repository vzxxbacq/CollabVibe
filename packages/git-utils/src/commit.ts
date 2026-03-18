/**
 * Worktree commit and diff utilities.
 *
 * Core principle: Git worktree is the single source of truth for file changes.
 * `commitAndDiffWorktreeChanges()` is the canonical entry point for computing
 * turn-level diffs at turn completion.
 */
import { access } from "node:fs/promises";
import { git } from "./git-exec";
import { createLogger } from "../../logger/src/index";

const log = createLogger("commit");

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface TurnDiffResult {
    filesChanged: string[];
    diffSummary: string;
    stats: { additions: number; deletions: number };
}

async function filterIgnoredPaths(worktreePath: string, paths: string[]): Promise<string[]> {
    if (paths.length === 0) return [];
    try {
        const { stdout } = await git(["check-ignore", "--no-index", ...paths], worktreePath, {
            logContext: { candidateCount: paths.length }
        });
        const ignored = new Set(stdout.split("\n").map((line) => line.trim()).filter(Boolean));
        return paths.filter((path) => !ignored.has(path));
    } catch {
        return paths;
    }
}

function parseStatusPaths(status: string): string[] {
    return status
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(3).trim().replace(/^"(.*)"$/, "$1"))
        .filter(Boolean);
}

async function hasTrackedEntries(worktreePath: string, context?: Record<string, unknown>): Promise<boolean> {
    const { stdout } = await git(["ls-files", "--cached", "-z"], worktreePath, { logContext: context });
    return stdout.length > 0;
}

/* ── Public Functions ──────────────────────────────────────────────────── */

/**
 * Check if a worktree has uncommitted changes (staged or unstaged).
 * Throws if the worktree path is missing or git status fails.
 */
export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
    try {
        await access(worktreePath);
    } catch (error) {
        throw new Error(`worktree path is not accessible: ${worktreePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { stdout } = await git(["status", "--porcelain"], worktreePath);
    const changedPaths = parseStatusPaths(stdout);
    const meaningfulPaths = await filterIgnoredPaths(worktreePath, changedPaths);
    return meaningfulPaths.length > 0;
}

/**
 * Compute diff from the worktree's uncommitted changes, then auto-commit.
 * This is the **single canonical entry point** for turn-level diff computation.
 *
 * Flow:
 * 1. Re-apply .gitignore (git rm --cached + git add -A)
 * 2. git diff HEAD --numstat (compute additions/deletions per file)
 * 3. git diff HEAD --patch  (capture full diff summary)
 * 4. git commit             (auto-commit)
 *
 * Returns null only if no changes exist.
 */
export async function commitAndDiffWorktreeChanges(
    worktreePath: string,
    commitMessage: string,
    context?: Record<string, unknown>
): Promise<TurnDiffResult | null> {
    try {
        await access(worktreePath);
    } catch (error) {
        throw new Error(`worktree path is not accessible: ${worktreePath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Re-apply .gitignore: clear index then re-add, so previously-tracked
    // files that now match .gitignore patterns get properly excluded.
    if (await hasTrackedEntries(worktreePath, context)) {
        await git(["rm", "-r", "--cached", ".", "--quiet"], worktreePath, { logContext: context });
    }
    await git(["add", "-A"], worktreePath, { logContext: context });

    // Check if there's anything to commit
    const { stdout: status } = await git(["status", "--porcelain"], worktreePath, { logContext: context });
    if (!status.trim()) {
        return null;
    }

    // Compute diff stats BEFORE commit (while changes are in index)
    let filesChanged: string[] = [];
    let additions = 0;
    let deletions = 0;
    let diffSummary = "";

    // --numstat gives machine-parseable per-file additions/deletions
    const { stdout: numstat } = await git(
        ["-c", "core.quotePath=false", "diff", "--cached", "--numstat"],
        worktreePath,
        { logContext: context }
    );
    for (const line of numstat.trim().split("\n").filter(Boolean)) {
        const [add, del, file] = line.split("\t");
        if (file) {
            filesChanged.push(file);
            // Binary files show "-" for additions/deletions
            if (add !== "-") additions += Number(add) || 0;
            if (del !== "-") deletions += Number(del) || 0;
        }
    }

    // Capture unified diff for detailed display
    const { stdout: patchOut } = await git(
        ["-c", "core.quotePath=false", "diff", "--cached", "--patch"],
        worktreePath,
        { maxBuffer: 1024 * 1024, logContext: context }
    );
    diffSummary = patchOut.trim();

    // Fallback removed: if numstat is unexpectedly empty, treat as error
    if (filesChanged.length === 0 && diffSummary) {
        throw new Error(`cached diff produced patch but no file list for worktree ${worktreePath}`);
    }

    // If we still have nothing meaningful, return null
    if (filesChanged.length === 0 && !diffSummary) {
        return null;
    }

    // Auto-commit
    await git(["commit", "-m", commitMessage, "--allow-empty-message"], worktreePath, { logContext: context });
    log.info({ worktreePath, filesChanged: filesChanged.length, additions, deletions, ...context }, "commitAndDiff: committed");

    return { filesChanged, diffSummary, stats: { additions, deletions } };
}
