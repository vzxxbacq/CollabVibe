/**
 * Internal Git CLI Gateway for the git-utils package.
 * 
 * IMPORTANT: This module is for package-internal use only.
 * DO NOT export `git` from index.ts. External consumers must use
 * domain APIs (repo, commit, merge, worktree, snapshot).
 */
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { getDefaultExcludesArgs } from "./default-excludes";
import { createLogger } from "../../channel-core/src/index";

const exec = promisify(execFileCb);
const log = createLogger("git");


export interface GitExecOptions {
    /** Override default 10MB max buffer */
    maxBuffer?: number;
    /** Structured log context propagated from the caller */
    logContext?: Record<string, unknown>;
}

/**
 * Execute a git command.
 * 
 * Automatically injects the system-level default excludes for all git
 * operations.
 * 
 * @param args Git CLI arguments (e.g., ["status", "--porcelain"])
 * @param cwd The working directory to run the command in
 * @param opts Additional execution options
 */
export async function git(
    args: string[],
    cwd: string,
    opts?: GitExecOptions
): Promise<{ stdout: string; stderr: string }> {
    // Find the first argument that isn't a flag to identify the subcommand
    const subcommand = args.find(a => !a.startsWith("-") && !a.includes("="));

    const fullArgs = [...getDefaultExcludesArgs(cwd), ...args];

    try {
        return await exec("git", fullArgs, {
            cwd,
            maxBuffer: opts?.maxBuffer ?? 10 * 1024 * 1024,
        });
    } catch (error) {
        // Log the failure at debug level so domain APIs can decide whether it's an error
        log.debug({ 
            cwd, 
            subcommand,
            ...opts?.logContext,
            err: error instanceof Error ? error.message : String(error) 
        }, "git command failed");
        throw error;
    }
}
