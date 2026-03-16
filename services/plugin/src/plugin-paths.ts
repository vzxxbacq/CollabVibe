import { join, resolve as pathResolve } from "node:path";

export const PLUGIN_DATA_ROOT_SEGMENT = "data";
export const PLUGIN_CANONICAL_STORE_SEGMENT = "plugins";
export const PLUGIN_STAGING_STORE_SEGMENT = "plugin-staging";

export const BACKEND_SKILL_DIRS = {
  codex: ".codex/skills",
  "claude-code": ".claude/skills",
  opencode: ".opencode/skills",
} as const;

export const ALL_BACKEND_SKILL_DIRS = Object.values(BACKEND_SKILL_DIRS);

export const PLUGIN_STAGING_SCOPE = {
  FEISHU_UPLOAD: "feishu-upload",
} as const;

export type PluginStagingScope = typeof PLUGIN_STAGING_SCOPE[keyof typeof PLUGIN_STAGING_SCOPE];

export function defaultPluginDirForBackend(backendName: string): string {
  return BACKEND_SKILL_DIRS[backendName as keyof typeof BACKEND_SKILL_DIRS] ?? BACKEND_SKILL_DIRS.codex;
}

export function resolvePluginDataRoot(baseCwd: string): string {
  return pathResolve(baseCwd, PLUGIN_DATA_ROOT_SEGMENT);
}

export function resolvePluginCanonicalStore(baseCwd: string): string {
  return join(resolvePluginDataRoot(baseCwd), PLUGIN_CANONICAL_STORE_SEGMENT);
}

export function resolvePluginStagingRoot(baseCwd: string): string {
  return join(resolvePluginDataRoot(baseCwd), PLUGIN_STAGING_STORE_SEGMENT);
}

export function buildPluginStagingDirName(scope: PluginStagingScope, actorId: string, now = Date.now()): string {
  return `${scope}-${now}-${sanitizePathSegment(actorId)}`;
}

function sanitizePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-z0-9._-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized || "system";
}
