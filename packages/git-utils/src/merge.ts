/**
 * Git merge operations for thread conflict resolution and branch merging.
 */
import { getWorktreePath, removeWorktree } from "./worktree";
import { git } from "./git-exec";
import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createLogger } from "../../logger/src/index";
import type { MergeLogContext } from "./merge-log-schema";
export type { MergeLogContext } from "./merge-log-schema";

const log = createLogger("git-merge");

function mergeLog(context?: MergeLogContext) {
    return context ? log.child(context) : log;
}

/**
 * Decode git's C-style quoted path: strip surrounding quotes, convert octal escapes.
 */
export function unquoteGitPath(raw: string): string {
    let s = raw;
    if (s.startsWith('"') && s.endsWith('"')) {
        s = s.slice(1, -1);
    }
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 3 < s.length && /^[0-3][0-7]{2}$/.test(s.slice(i + 1, i + 4))) {
            bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
            i += 3;
        } else {
            bytes.push(s.charCodeAt(i));
        }
    }
    return Buffer.from(bytes).toString('utf8');
}

/**
 * Ensure repo is not in a "merging" state — clean up stale MERGE_HEAD.
 */
async function ensureCleanMergeState(cwd: string, context?: MergeLogContext): Promise<void> {
    const logger = mergeLog(context);
    try {
        const { stdout } = await git(["rev-parse", "--git-dir"], cwd, { logContext: context });
        let gitDir = stdout.trim();
        if (!gitDir) {
            throw new Error(`git dir is empty for repo: ${cwd}`);
        }
        if (!gitDir.startsWith("/")) {
            gitDir = join(cwd, gitDir);
        }
        await access(join(gitDir, "MERGE_HEAD"));
        logger.warn({ cwd }, "dryRunMerge: stale MERGE_HEAD detected, resetting");
        await git(["reset", "--merge"], cwd, { logContext: context });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("ENOENT")) {
            return;
        }
        throw error;
    }
}

/* ── Merge diff types (canonical definitions) ──────────────────────────── */

export interface MergeDiffStats {
    additions: number;
    deletions: number;
    filesChanged: string[];
    fileDiffs?: Array<{ file: string; diff: string }>;
}

export interface DryRunMergeResult {
    canMerge: boolean;
    conflicts?: string[];
    diffStats?: MergeDiffStats;
}

/**
 * Dry-run merge: detect conflicts and collect diff stats without modifying HEAD.
 */
export async function dryRunMerge(
    mainCwd: string,
    branchName: string,
    context?: MergeLogContext
): Promise<DryRunMergeResult> {
    const logger = mergeLog(context);
    logger.info({ mainCwd, branchName }, "dryRunMerge: START");

    await ensureCleanMergeState(mainCwd, context);

    try {
        const { stdout: preIndexStatus } = await git(["diff", "--cached", "--stat"], mainCwd, { logContext: context });
        if (preIndexStatus.trim()) {
            logger.warn({ preIndexStatus: preIndexStatus.trim() }, "dryRunMerge: DIRTY INDEX before merge");
        } else {
            logger.info("dryRunMerge: index is clean before merge");
        }
    } catch { /* ignore */ }

    try {
        const mergeResult = await git(["merge", "--no-commit", "--no-ff", branchName], mainCwd, { logContext: context });
        logger.info({ stdout: mergeResult.stdout?.slice(0, 200), stderr: mergeResult.stderr?.slice(0, 200) }, "dryRunMerge: merge succeeded");

        let diffStats: MergeDiffStats | undefined;
        try {
            const { stdout: statOutput } = await git(["-c", "core.quotePath=false", "diff", "--cached", "--stat"], mainCwd, { logContext: context });
            const { stdout: nameOutput } = await git(["-c", "core.quotePath=false", "diff", "--cached", "--name-only", "-z"], mainCwd, { logContext: context });
            logger.info({ statOutput: statOutput.slice(0, 500), nameOutput: nameOutput.slice(0, 500) }, "dryRunMerge: raw diff outputs");

            const filesChanged = nameOutput.split("\0").filter(Boolean);
            const addMatch = statOutput.match(/(\d+) insertion/);
            const delMatch = statOutput.match(/(\d+) deletion/);
            const additions = addMatch ? Number(addMatch[1]) : 0;
            const deletions = delMatch ? Number(delMatch[1]) : 0;
            logger.info({ additions, deletions, filesChanged, addMatch: addMatch?.[0], delMatch: delMatch?.[0] }, "dryRunMerge: parsed stats");

            const fileDiffs: Array<{ file: string; diff: string }> = [];
            for (const file of filesChanged) {
                try {
                    const { stdout: fileDiff } = await git(
                        ["-c", "core.quotePath=false", "diff", "--cached", "--", file], mainCwd, { logContext: context }
                    );
                    fileDiffs.push({ file, diff: fileDiff.trim() });
                } catch { /* ignore individual file diff failure */ }
            }

            diffStats = { additions, deletions, filesChanged, fileDiffs };
        } catch { /* stat failure is non-critical */ }

        await git(["reset", "--merge"], mainCwd, { logContext: context }).catch(async () => {
            await git(["merge", "--abort"], mainCwd, { logContext: context }).catch(() => { });
        });
        logger.info({ canMerge: true, hasStats: !!diffStats, additions: diffStats?.additions, deletions: diffStats?.deletions, fileCount: diffStats?.filesChanged.length }, "dryRunMerge: RESULT");
        return { canMerge: true, diffStats };
    } catch (err) {
        const errObj = err as Error & { stderr?: string; stdout?: string };
        const msg = [errObj.stdout, errObj.stderr, errObj.message].filter(Boolean).join("\n");
        logger.warn({ branchName, msg: msg.slice(0, 300) }, "dryRunMerge: merge failed");

        if (msg.includes("CONFLICT") || msg.includes("Automatic merge failed")) {
            let conflicts: string[] = [];
            try {
                const { stdout: diffOutput } = await git(
                    ["-c", "core.quotePath=false", "diff", "--name-only", "--diff-filter=U", "-z"], mainCwd, { logContext: context }
                );
                conflicts = diffOutput.split("\0").filter(Boolean);
            } catch { /* ignore */ }

            await git(["reset", "--merge"], mainCwd, { logContext: context }).catch(async () => {
                await git(["merge", "--abort"], mainCwd, { logContext: context }).catch(() => { });
            });
            return { canMerge: false, conflicts };
        }

        await git(["reset", "--merge"], mainCwd, { logContext: context }).catch(async () => {
            await git(["merge", "--abort"], mainCwd, { logContext: context }).catch(() => { });
        });
        throw err;
    }
}

/**
 * Start a conflicting merge in a worktree — keeps conflict markers for agent resolution.
 */
export async function startConflictMerge(
    worktreePath: string,
    branchName: string,
    context?: MergeLogContext
): Promise<{ conflicts: string[] }> {
    const logger = mergeLog(context);
    try {
        await git(["merge", branchName, "--no-edit"], worktreePath, { logContext: context });
        return { conflicts: [] };
    } catch (err) {
        const errObj = err as Error & { stderr?: string; stdout?: string };
        const msg = [errObj.stdout, errObj.stderr, errObj.message].filter(Boolean).join("\n");
        logger.info({ branchName, msg: msg.slice(0, 200) }, "startConflictMerge: merge produced conflicts");

        const { stdout: diffOutput } = await git(
            ["-c", "core.quotePath=false", "diff", "--name-only", "--diff-filter=U", "-z"], worktreePath, { logContext: context }
        );
        const conflicts = diffOutput.split("\0").filter(Boolean);
        return { conflicts };
    }
}

/**
 * Check if all merge conflicts in a worktree have been resolved.
 */
export async function checkConflictsResolved(
    worktreePath: string,
    context?: MergeLogContext
): Promise<{ resolved: boolean; remaining: string[] }> {
    const { stdout } = await git(
        ["-c", "core.quotePath=false", "ls-files", "-u", "-z"], worktreePath, { logContext: context }
    );
    const entries = stdout.split("\0").filter(Boolean);
    const fileNames = [...new Set(entries.map(e => {
        const tabIdx = e.indexOf("\t");
        return tabIdx >= 0 ? e.slice(tabIdx + 1) : e;
    }))];
    return { resolved: fileNames.length === 0, remaining: fileNames };
}

export async function readWorktreeStatusMap(
    cwd: string,
    context?: MergeLogContext
): Promise<Record<string, string>> {
    const { stdout } = await git(
        ["-c", "core.quotePath=false", "status", "--porcelain", "-z"],
        cwd,
        { logContext: context }
    );
    const entries = stdout.split("\0").filter(Boolean);
    const result: Record<string, string> = {};
    for (const entry of entries) {
        const status = entry.slice(0, 2);
        const path = entry.slice(3).trim();
        if (path) {
            const [indexSignature, worktreeSignature] = await Promise.all([
                readIndexSignature(cwd, path, context),
                readWorktreeSignature(cwd, path),
            ]);
            result[path] = `${status}|${indexSignature}|${worktreeSignature}`;
        }
    }
    return result;
}

async function readIndexSignature(cwd: string, filePath: string, context?: MergeLogContext): Promise<string> {
    try {
        const { stdout } = await git(
            ["ls-files", "-s", "--", filePath],
            cwd,
            { logContext: context }
        );
        return stdout.trim() || "-";
    } catch {
        return "-";
    }
}

async function readWorktreeSignature(cwd: string, filePath: string): Promise<string> {
    try {
        const content = await readFile(join(cwd, filePath));
        return createHash("sha1").update(content).digest("hex");
    } catch {
        return "-";
    }
}

/**
 * Merge a worktree branch into the current branch (usually main).
 */
export async function mergeWorktree(
    mainCwd: string,
    branchName: string,
    force?: boolean,
    context?: MergeLogContext
): Promise<{ success: boolean; message: string; conflicts?: string[] }> {
    const logger = mergeLog(context);
    const worktreePath = getWorktreePath(mainCwd, branchName);

    await access(worktreePath);
    // Re-apply .gitignore: clear index then re-add, so previously-tracked
    // files that now match .gitignore patterns get properly excluded.
    if (await hasTrackedEntries(worktreePath, context)) {
        await git(["rm", "-r", "--cached", ".", "--quiet"], worktreePath, { logContext: context });
    }
    await git(["add", "-A"], worktreePath, { logContext: context });
    const { stdout: status } = await git(["status", "--porcelain"], worktreePath, { logContext: context });
    if (status.trim()) {
        await git(["commit", "-m", `[codex] thread ${branchName} changes`, "--allow-empty-message"], worktreePath, { logContext: context });
        logger.info({ worktreePath }, "merge: auto-committed changes");
    }

    try {
        let stdout: string;
        if (force) {
            ({ stdout } = await git(["merge", branchName, "-X", "theirs", "--no-edit"], mainCwd, { logContext: context }));
        } else {
            ({ stdout } = await git(["merge", branchName, "--no-edit"], mainCwd, { logContext: context }));
        }

        await removeWorktree(mainCwd, worktreePath, branchName);
        logger.info({ worktreePath, branchName }, "merge: removed worktree");

        return { success: true, message: stdout.trim() };
    } catch (err) {
        const errObj = err as Error & { stderr?: string; stdout?: string };
        const msg = [errObj.stdout, errObj.stderr, errObj.message].filter(Boolean).join("\n");

        if (msg.includes("CONFLICT") || msg.includes("Automatic merge failed")) {
            const { stdout: diffOutput } = await git(
                ["-c", "core.quotePath=false", "diff", "--name-only", "--diff-filter=U", "-z"], mainCwd, { logContext: context }
            );
            const conflicts = diffOutput.split("\0").filter(Boolean);
            await git(["reset", "--merge"], mainCwd, { logContext: context });
            return { success: false, message: "合并冲突", conflicts };
        }
        return { success: false, message: msg };
    }
}

/* ── Merge Session (per-file review — PR-style) ──────────────────────────── */
/*                                                                              
 * PR-style: `git merge main` in the **branch worktree**, resolve conflicts
 * there (Agent cwd matches worktree), then commit. Finally fast-forward
 * mainCwd to the branch.                                                      
 */

import type { MergeFileStatus, MergeFileDecision } from "../../../services/contracts/im/im-output";

export interface MergeFileInfo {
    path: string;
    status: MergeFileStatus;
    diff: string;
}

export interface MergeSessionResult {
    files: MergeFileInfo[];
    /** SHA before the merge (for snapshot/rollback) */
    preMergeSha: string;
}

async function readGitOutput(args: string[], cwd: string, context?: MergeLogContext): Promise<string> {
    try {
        const { stdout } = await git(args, cwd, { maxBuffer: 1024 * 1024, logContext: context });
        return stdout.trim();
    } catch {
        return "";
    }
}

async function hasTrackedEntries(cwd: string, context?: MergeLogContext): Promise<boolean> {
    const { stdout } = await git(["ls-files", "--cached", "-z"], cwd, { logContext: context });
    return stdout.length > 0;
}

async function buildConflictPresentation(
    worktreeCwd: string,
    filePath: string,
    context?: MergeLogContext
): Promise<string> {
    const [combinedDiff, stage1, stage2, stage3] = await Promise.all([
        readGitOutput(["-c", "core.quotePath=false", "diff", "--", filePath], worktreeCwd, context),
        readGitOutput(["-c", "core.quotePath=false", "show", `:1:${filePath}`], worktreeCwd, context),
        readGitOutput(["-c", "core.quotePath=false", "show", `:2:${filePath}`], worktreeCwd, context),
        readGitOutput(["-c", "core.quotePath=false", "show", `:3:${filePath}`], worktreeCwd, context),
    ]);

    const sections: string[] = [];
    if (combinedDiff) {
        sections.push(combinedDiff);
    }
    if (!stage1 && stage2 && stage3) {
        sections.push(
            "#### add/add conflict",
            "```ours",
            stage2,
            "```",
            "```theirs",
            stage3,
            "```"
        );
        return sections.join("\n\n");
    }
    if (stage1 || stage2 || stage3) {
        sections.push(
            ...(stage1 ? ["```base", stage1, "```"] : []),
            ...(stage2 ? ["```ours", stage2, "```"] : []),
            ...(stage3 ? ["```theirs", stage3, "```"] : [])
        );
    }
    return sections.join("\n\n");
}

async function readReviewDiff(
    worktreeCwd: string,
    filePath: string,
    status: MergeFileStatus,
    context?: MergeLogContext
): Promise<string> {
    if (status === "conflict") {
        return buildConflictPresentation(worktreeCwd, filePath, context);
    }
    return readGitOutput(["-c", "core.quotePath=false", "diff", "--cached", "--", filePath], worktreeCwd, context);
}

/**
 * Stage 1: Start a merge session — PR-style `merge main --no-commit` in worktree.
 * Leaves the worktree in a "merging" state; caller MUST eventually call
 * `commitMergeSession` or `abortMergeSession`.
 */
export async function startMergeSession(
    worktreeCwd: string,
    baseBranch: string,
    context?: MergeLogContext
): Promise<MergeSessionResult> {
    const logger = mergeLog(context);
    logger.info({ worktreeCwd, baseBranch }, "startMergeSession: START (PR-style)");

    await ensureCleanMergeState(worktreeCwd, context);

    // Capture pre-merge SHA (branch HEAD)
    const { stdout: shaOut } = await git(["rev-parse", "HEAD"], worktreeCwd, { logContext: context });
    const preMergeSha = shaOut.trim();

    // PR-style: merge main into branch worktree
    try {
        await git(["merge", "--no-commit", "--no-ff", baseBranch], worktreeCwd, { logContext: context });
    } catch (err) {
        const errObj = err as Error & { stderr?: string; stdout?: string };
        const msg = [errObj.stdout, errObj.stderr, errObj.message].filter(Boolean).join("\n");
        if (!msg.includes("CONFLICT") && !msg.includes("Automatic merge failed")) {
            await git(["merge", "--abort"], worktreeCwd, { logContext: context }).catch(() => {});
            throw err;
        }
        logger.info("startMergeSession: merge has conflicts (expected)");
    }

    // Classify files
    const files: MergeFileInfo[] = [];

    // 1. Get unmerged (conflict) files
    let conflictFiles: string[] = [];
    try {
        const { stdout } = await git(
            ["-c", "core.quotePath=false", "diff", "--name-only", "--diff-filter=U", "-z"],
            worktreeCwd, { logContext: context }
        );
        conflictFiles = stdout.split("\0").filter(Boolean);
    } catch { /* no conflicts */ }

    // 2. Get all changed files
    let changedEntries: Array<{ status: string; path: string }> = [];
    try {
        const { stdout } = await git(
            ["-c", "core.quotePath=false", "diff", "--cached", "--name-status", "-z"],
            worktreeCwd, { logContext: context }
        );
        const parts = stdout.split("\0").filter(Boolean);
        for (let i = 0; i < parts.length - 1; i += 2) {
            changedEntries.push({ status: parts[i]!, path: parts[i + 1]! });
        }
    } catch { /* ignore */ }

    // 3. Build file list with per-file diffs
    const conflictSet = new Set(conflictFiles);
    for (const entry of changedEntries) {
        const fileStatus: MergeFileStatus = conflictSet.has(entry.path)
            ? "conflict"
            : entry.status.startsWith("A") ? "added"
            : entry.status.startsWith("D") ? "deleted"
            : "auto_merged";

        const diff = await readReviewDiff(worktreeCwd, entry.path, fileStatus, context);

        files.push({ path: entry.path, status: fileStatus, diff });
    }

    // Also add conflict files not in --cached (rare edge case)
    for (const cf of conflictFiles) {
        if (!files.some(f => f.path === cf)) {
            const diff = await readReviewDiff(worktreeCwd, cf, "conflict", context);
            files.push({ path: cf, status: "conflict", diff });
        }
    }

    logger.info({
        totalFiles: files.length,
        conflicts: conflictFiles.length,
        autoMerged: files.filter(f => f.status === "auto_merged").length,
    }, "startMergeSession: DONE");

    return { files, preMergeSha };
}

/**
 * Stage 2: Apply a user decision to a single file within an active merge session.
 * PR-style: worktree is on branch, merging main in.
 *   keep_main  → use main's version (`checkout main --`)
 *   use_branch → use branch's version (`checkout HEAD --`)
 *   accept     → accept merge result (with conflict marker guard)
 */
export async function applyFileDecision(
    worktreeCwd: string,
    filePath: string,
    decision: MergeFileDecision,
    baseBranch: string,
    context?: MergeLogContext
): Promise<void> {
    const logger = mergeLog(context);
    logger.info({ worktreeCwd, filePath, decision, baseBranch }, "applyFileDecision");

    switch (decision) {
        case "keep_main":
            // Use base branch's version (we're merging baseBranch into branch)
            await git(["checkout", baseBranch, "--", filePath], worktreeCwd, { logContext: context });
            await git(["add", "--", filePath], worktreeCwd, { logContext: context });
            break;
        case "use_branch":
            // Use branch's pre-merge version (HEAD before merge = branch tip)
            await git(["checkout", "HEAD", "--", filePath], worktreeCwd, { logContext: context });
            await git(["add", "--", filePath], worktreeCwd, { logContext: context });
            break;
        case "accept": {
            // Accept merged/agent-resolved version — guard against conflict markers
            const content = await readFile(join(worktreeCwd, filePath), "utf-8");
            if (content.includes("<<<<<<<") && content.includes(">>>>>>>")) {
                throw new Error(`文件 ${filePath} 仍有未解决的冲突标记，无法 accept`);
            }
            const { stdout } = await git(["ls-files", "-u", "--", filePath], worktreeCwd, { logContext: context });
            if (stdout.trim()) {
                throw new Error(`文件 ${filePath} 在 git index 中仍是未解决冲突，无法 accept`);
            }
            await git(["add", "--", filePath], worktreeCwd, { logContext: context });
            break;
        }
        case "skip":
            // Remove the file from the merge
            await git(["rm", "-f", "--", filePath], worktreeCwd, { logContext: context }).catch(async () => {
                await git(["checkout", "HEAD", "--", filePath], worktreeCwd, { logContext: context }).catch(() => {});
            });
            break;
    }
}

/**
 * Stage 3: Commit the merge result in the worktree.
 */
export async function commitMergeSession(
    worktreeCwd: string,
    branchName: string,
    baseBranch: string,
    message?: string,
    context?: MergeLogContext
): Promise<{ success: boolean; message: string }> {
    const commitMsg = message ?? `Merge ${baseBranch} into '${branchName}' (per-file review)`;
    const logger = mergeLog(context);
    logger.info({ worktreeCwd, branchName, commitMsg }, "commitMergeSession");

    try {
        const { stdout } = await git(
            ["commit", "-m", commitMsg, "--allow-empty"],
            worktreeCwd,
            { logContext: context }
        );
        return { success: true, message: stdout.trim() };
    } catch (err) {
        const errObj = err as Error & { stderr?: string; stdout?: string };
        const msg = [errObj.stdout, errObj.stderr, errObj.message].filter(Boolean).join("\n");
        return { success: false, message: msg };
    }
}

/**
 * Stage 4: Fast-forward main to the branch after worktree commit.
 * This is the final step — main now includes all resolved changes.
 */
export async function fastForwardMain(
    mainCwd: string,
    branchName: string,
    baseBranch: string,
    context?: MergeLogContext
): Promise<{ success: boolean; message: string }> {
    const logger = mergeLog(context);
    logger.info({ mainCwd, branchName, baseBranch }, "fastForwardMain");
    try {
        const { stdout } = await git(
            ["merge", branchName, "--ff-only"],
            mainCwd,
            { logContext: context }
        );
        return { success: true, message: stdout.trim() };
    } catch (err) {
        const errObj = err as Error & { stderr?: string; stdout?: string };
        const msg = [errObj.stdout, errObj.stderr, errObj.message].filter(Boolean).join("\n");
        return { success: false, message: msg };
    }
}

/**
 * Abort: cancel an in-progress merge session, restoring to pre-merge state.
 */
export async function abortMergeSession(cwd: string, context?: MergeLogContext): Promise<void> {
    const logger = mergeLog(context);
    logger.info({ cwd }, "abortMergeSession");
    await git(["merge", "--abort"], cwd, { logContext: context }).catch(async () => {
        await git(["reset", "--merge"], cwd, { logContext: context }).catch(() => {});
    });
}

/**
 * Automates checking if there's any uncommitted changes in the worktree,
 * and if so, adding all changes and committing them with the given message.
 * @returns true if a commit was made, false otherwise
 */
export async function commitWorktreeChanges(cwd: string, message: string, context?: MergeLogContext): Promise<boolean> {
    await git(["add", "-A"], cwd, { logContext: context });
    const { stdout: status } = await git(["status", "--porcelain"], cwd, { logContext: context });
    if (!status.trim()) {
        return false;
    }
    await git(["commit", "-m", message, "--allow-empty-message"], cwd, { logContext: context });
    return true;
}

/**
 * Reads the cached (staged) diff string for a specific file.
 * Useful for grabbing diff content without shell-piping.
 */
export async function readCachedFileDiff(cwd: string, filePath: string, context?: MergeLogContext): Promise<string> {
    const { stdout: unresolved } = await git(["ls-files", "-u", "--", filePath], cwd, { maxBuffer: 1024 * 1024, logContext: context });
    if (unresolved.trim()) {
        return await buildConflictPresentation(cwd, filePath, context);
    }
    const { stdout } = await git(["diff", "--cached", "--", filePath], cwd, { maxBuffer: 1024 * 1024, logContext: context });
    return stdout;
}
