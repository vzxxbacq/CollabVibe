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
        await git(["clone", cloneUrl, "."], cwd);
    } else {
        await git(["init"], cwd);
        await git(["commit", "--allow-empty", "-m", "initial commit"], cwd);
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
    await git(["clone", "--depth", "1", source, targetDir], process.cwd());
}
