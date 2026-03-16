/**
 * Worktree commit and diff utilities.
 *
 * Core principle: Git worktree is the single source of truth for file changes.
 * `commitAndDiffWorktreeChanges()` is the canonical entry point for computing
 * turn-level diffs at turn completion.
 */
import { access } from "node:fs/promises";
import { git } from "./git-exec";
import { createLogger } from "../../channel-core/src/index";

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

/* ── Public Functions ──────────────────────────────────────────────────── */

/**
 * Check if a worktree has uncommitted changes (staged or unstaged).
 * Returns false if the worktree path doesn't exist.
 */
export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
    try {
        await access(worktreePath);
    } catch {
        return false;
    }
    try {
        const { stdout } = await git(["status", "--porcelain"], worktreePath);
        const changedPaths = parseStatusPaths(stdout);
        const meaningfulPaths = await filterIgnoredPaths(worktreePath, changedPaths);
        return meaningfulPaths.length > 0;
    } catch (err) {
        log.warn({ worktreePath, err: err instanceof Error ? err.message : err }, "isWorktreeDirty: git status failed");
        return false;
    }
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
 * Returns null if no changes exist.
 */
export async function commitAndDiffWorktreeChanges(
    worktreePath: string,
    commitMessage: string,
    context?: Record<string, unknown>
): Promise<TurnDiffResult | null> {
    try {
        await access(worktreePath);
    } catch {
        return null;
    }

    try {
        // Re-apply .gitignore: clear index then re-add, so previously-tracked
        // files that now match .gitignore patterns get properly excluded.
        await git(["rm", "-r", "--cached", ".", "--quiet"], worktreePath, { logContext: context }).catch((error) => {
            log.debug({ worktreePath, ...context, err: error instanceof Error ? error.message : String(error) }, "commitAndDiff: rm cached skipped");
        });
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

        try {
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
        } catch (error) {
            log.debug({ worktreePath, ...context, err: error instanceof Error ? error.message : String(error) }, "commitAndDiff: numstat failed");
        }

        try {
            // Capture unified diff for detailed display
            const { stdout: patchOut } = await git(
                ["-c", "core.quotePath=false", "diff", "--cached", "--patch"],
                worktreePath,
                { maxBuffer: 1024 * 1024, logContext: context }
            );
            diffSummary = patchOut.trim();
        } catch (error) {
            log.debug({ worktreePath, ...context, err: error instanceof Error ? error.message : String(error) }, "commitAndDiff: patch diff failed");
        }

        // Fallback: if numstat failed, parse file list from porcelain status
        if (filesChanged.length === 0) {
            filesChanged = parseStatusPaths(status);
        }

        // If we still have nothing meaningful, return null
        if (filesChanged.length === 0 && !diffSummary) {
            return null;
        }

        // Auto-commit
        await git(["commit", "-m", commitMessage, "--allow-empty-message"], worktreePath, { logContext: context });
        log.info({ worktreePath, filesChanged: filesChanged.length, additions, deletions, ...context }, "commitAndDiff: committed");

        return { filesChanged, diffSummary, stats: { additions, deletions } };
    } catch (err) {
        log.warn({ worktreePath, ...context, err: err instanceof Error ? err.message : err }, "commitAndDiff: failed");
        return null;
    }
}
