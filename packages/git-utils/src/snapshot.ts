/**
 * Git snapshot management for turn-level state tracking.
 */
import { join } from "node:path";
import { git } from "./git-exec";

/**
 * Create a snapshot of the working tree before a turn starts.
 * Uses `git stash create` to create a stash object without modifying working tree.
 * Falls back to HEAD if no changes exist.
 */
export async function createSnapshot(cwd: string): Promise<string> {
    await git(["add", "-A"], cwd);
    const { stdout: stashSha } = await git(["stash", "create"], cwd);
    
    await git(["reset", "HEAD"], cwd);

    if (!stashSha.trim()) {
        const { stdout: headSha } = await git(["rev-parse", "HEAD"], cwd);
        return headSha.trim();
    }
    return stashSha.trim();
}

/**
 * Pin a snapshot SHA with a permanent git tag to prevent GC.
 */
export async function pinSnapshot(cwd: string, sha: string, label: string): Promise<void> {
    await git(["tag", "-f", label, sha], cwd);
}

/**
 * Restore working tree to a snapshot state.
 */
export async function restoreSnapshot(cwd: string, sha: string): Promise<void> {
    await git(["checkout", sha, "--", "."], cwd);
    await git(["clean", "-fd"], cwd);
    await git(["reset", "HEAD"], cwd);
}

export interface DiffFile {
    status: "A" | "M" | "D";
    path: string;
    additions: number;
    deletions: number;
}

export interface SnapshotDiff {
    files: DiffFile[];
    summary: string;
}

/**
 * Diff a snapshot against the current working tree.
 */
export async function diffSnapshot(cwd: string, sha: string): Promise<SnapshotDiff> {
    const [{ stdout: numstat }, { stdout: nameStatus }] = await Promise.all([
        git(["diff", sha, "--numstat"], cwd),
        git(["diff", sha, "--name-status"], cwd)
    ]);

    const statusMap = new Map<string, "A" | "M" | "D">();
    for (const line of nameStatus.trim().split("\n")) {
        if (!line) continue;
        const [s, p] = line.split("\t");
        if (s && p) {
            statusMap.set(p, s.charAt(0) as "A" | "M" | "D");
        }
    }

    const files: DiffFile[] = [];
    for (const line of numstat.trim().split("\n")) {
        if (!line) continue;
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const additions = parts[0] === "-" ? 0 : Number(parts[0]);
        const deletions = parts[1] === "-" ? 0 : Number(parts[1]);
        const path = parts[2]!;
        files.push({
            status: statusMap.get(path) ?? "M",
            path,
            additions,
            deletions
        });
    }

    const MAX_DIFF_CHARS = 2000;
    const { stdout: unifiedDiff } = await git(["diff", sha], cwd);
    const summary = unifiedDiff.length > MAX_DIFF_CHARS
        ? unifiedDiff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)"
        : unifiedDiff;

    return { files, summary };
}
