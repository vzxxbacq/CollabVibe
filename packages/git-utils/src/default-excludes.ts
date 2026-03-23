/**
 * Default excludes for worktree Git operations.
 *
 * Reads exclude patterns from the system-level `data/config/default.gitignore`.
 * If the file doesn't exist, auto-seeds it with built-in defaults.
 * Returns Git CLI args: `["-c", "core.excludesFile=<path>"]`.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/** Config file path relative to workspace data dir. */
const CONFIG_FILE = "data/config/default.gitignore";

/**
 * Built-in fallback patterns — written to the config file only when it
 * doesn't exist yet. After seeding, the file becomes the single source
 * of truth and can be edited freely by the operator.
 */
const BUILTIN_DEFAULTS = `# Python
.venv/
venv/
__pycache__/
*.pyc
*.pyo
.eggs/
*.egg-info/
.mypy_cache/
.pytest_cache/

# Node.js
node_modules/

# Agent runtime dirs (backend-local state/config/symlinks)
.codex/
.claude/
.opencode/

# Rust
target/

# Java / Kotlin / Gradle
build/
.gradle/

# C / C++
*.o
*.so
*.dylib

# OS artifacts
.DS_Store
Thumbs.db

# Editor swap files
*.swp
*.swo
*~
`;

/** Cached resolved absolute path (singleton). */
let resolvedPath: string | null = null;

/**
 * Return git CLI args that inject the default excludes file.
 *
 * Important: this is a system-level config, not a per-project/worktree file.
 * Callers may still pass `cwd` for backwards compatibility, but it is ignored.
 *
 * @param _cwd Legacy parameter kept for API compatibility.
 * @returns `["-c", "core.excludesFile=<absolute path>"]`
 */
export function getDefaultExcludesArgs(_cwd?: string): string[] {
    if (!resolvedPath) {
        const workspaceCwd = process.env.COLLABVIBE_WORKSPACE_CWD;
        if (!workspaceCwd) {
            throw new Error("COLLABVIBE_WORKSPACE_CWD is required but not set");
        }
        resolvedPath = join(workspaceCwd, CONFIG_FILE);

        if (!existsSync(resolvedPath)) {
            mkdirSync(dirname(resolvedPath), { recursive: true });
            writeFileSync(resolvedPath, BUILTIN_DEFAULTS);
        }
    }
    return ["-c", `core.excludesFile=${resolvedPath}`];
}
