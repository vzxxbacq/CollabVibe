/**
 * Repository-level git operations.
 * Used for project initialization, cloning, and remote management.
 */
import { git } from "./git-exec";

/**
 * Initialize a new repository or clone from an existing URL.
 * 
 * @param cwd The directory to initialize or clone into
 * @param cloneUrl Optional URL to clone from. If not provided, initializes a new empty repo.
 */
export async function initRepo(cwd: string, cloneUrl?: string): Promise<void> {
    if (cloneUrl) {
        await git(["clone", cloneUrl, "."], cwd, { injectDefaultExcludes: false });
    } else {
        await git(["init"], cwd, { injectDefaultExcludes: false });
        await git(["commit", "--allow-empty", "-m", "initial commit"], cwd, { injectDefaultExcludes: false });
    }
}

/**
 * Get the current remote origin URL.
 * 
 * @param cwd Repository path
 * @returns The remote URL, or null if no origin exists
 */
export async function getRemoteUrl(cwd: string): Promise<string | null> {
    try {
        const { stdout } = await git(["remote", "get-url", "origin"], cwd);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Detect the repository's default/base branch.
 *
 * Order:
 * 1. remote HEAD (origin/HEAD)
 * 2. current symbolic HEAD
 * 3. single local branch
 * 4. conventional names main/master
 */
export async function detectDefaultBranch(cwd: string): Promise<string> {
    try {
        const { stdout } = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd);
        const remoteHead = stdout.trim();
        if (remoteHead) {
            return remoteHead.replace(/^origin\//, "");
        }
    } catch {
        // no remote HEAD
    }

    try {
        const { stdout } = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
        const head = stdout.trim();
        if (head) {
            return head;
        }
    } catch {
        // detached or invalid HEAD
    }

    try {
        const { stdout } = await git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], cwd);
        const branches = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
        if (branches.length === 1) {
            return branches[0]!;
        }
        if (branches.includes("main")) {
            return "main";
        }
        if (branches.includes("master")) {
            return "master";
        }
    } catch {
        // branch listing failed
    }

    throw new Error(`unable to detect default branch for repo: ${cwd}`);
}

export async function getCurrentBranch(cwd: string): Promise<string> {
    const { stdout } = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
    const branch = stdout.trim();
    if (!branch) {
        throw new Error(`unable to resolve current branch for repo: ${cwd}`);
    }
    return branch;
}

/**
 * Set or add the remote origin URL.
 * 
 * @param cwd Repository path
 * @param url The remote URL to set
 */
export async function setRemoteUrl(cwd: string, url: string): Promise<void> {
    try {
        // Check if origin exists
        await git(["remote", "get-url", "origin"], cwd);
        // Exists, set it
        await git(["remote", "set-url", "origin", url], cwd);
    } catch {
        // Doesn't exist, add it
        await git(["remote", "add", "origin", url], cwd);
    }
}

/**
 * Perform a shallow clone for plugin installation.
 * 
 * @param source Git repository URL or path
 * @param targetDir Destination directory
 */
export async function shallowClone(source: string, targetDir: string): Promise<void> {
    // Note: cwd doesn't matter much for clone since it creates the targetDir
    await git(["clone", "--depth", "1", source, targetDir], process.cwd(), { injectDefaultExcludes: false });
}

/**
 * Ensure a work branch exists in the repository.
 * If the branch doesn't exist, creates it from `fromBranch`.
 * Checks out the work branch after creation.
 *
 * @param cwd Repository path
 * @param branchName The work branch to ensure (e.g. "codex/my-project")
 * @param fromBranch The branch to create from (e.g. "main")
 */
export async function ensureWorkBranch(cwd: string, branchName: string, fromBranch: string): Promise<void> {
    // Check if branch already exists locally
    try {
        await git(["rev-parse", "--verify", `refs/heads/${branchName}`], cwd);
        // Branch exists, just checkout
        await git(["checkout", branchName], cwd);
        return;
    } catch {
        // Branch doesn't exist locally, create it
    }

    // Prefer remote tracking branch origin/{branchName} if it exists,
    // so the local branch content matches the remote (e.g. origin/dev).
    // Only fall back to fromBranch (e.g. main) when no remote match exists.
    let base = fromBranch;
    try {
        await git(["rev-parse", "--verify", `refs/remotes/origin/${branchName}`], cwd);
        base = `origin/${branchName}`;
    } catch {
        // No remote tracking branch, use fromBranch
    }
    await git(["checkout", "-b", branchName, base], cwd);
}

/**
 * Push a branch to the remote.
 *
 * @param cwd Repository path
 * @param branchName Branch to push
 * @param remote Remote name (default: "origin")
 */
export async function pushBranch(cwd: string, branchName: string, remote = "origin"): Promise<void> {
    await git(["push", remote, branchName], cwd);
}

/**
 * Check whether `ancestor` is an ancestor of `descendant`.
 * Uses `git merge-base --is-ancestor` (exit 0 = true, exit 1 = false).
 */
export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
    try {
        await git(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
        return true;
    } catch {
        return false;
    }
}

/**
 * Fetch from a remote to ensure ref freshness.
 *
 * @param cwd Repository path
 * @param remote Remote name (default: "origin")
 */
export async function fetchRemote(cwd: string, remote = "origin"): Promise<void> {
    await git(["fetch", remote], cwd);
}

/**
 * Resolve an arbitrary ref (branch, tag, remote-tracking, SHA prefix) to a
 * full SHA-1 hash.
 *
 * @param cwd Repository path
 * @param ref The ref to resolve (e.g. "origin/main", "HEAD", "abc1234")
 * @returns Full SHA-1 string
 * @throws If the ref cannot be resolved
 */
export async function resolveRef(cwd: string, ref: string): Promise<string> {
    const { stdout } = await git(["rev-parse", ref], cwd);
    const sha = stdout.trim();
    if (!sha) {
        throw new Error(`unable to resolve ref "${ref}" in ${cwd}`);
    }
    return sha;
}

/**
 * Hard-reset the current branch to a target ref.
 * Used for the defensive "rewrite" mode of project pull.
 *
 * @param cwd Repository path (must be on the branch to reset)
 * @param targetRef The ref to reset to (SHA or ref name)
 * @returns The new HEAD SHA after reset
 */
export async function resetHard(cwd: string, targetRef: string): Promise<string> {
    await git(["reset", "--hard", targetRef], cwd);
    const { stdout } = await git(["rev-parse", "HEAD"], cwd);
    return stdout.trim();
}

