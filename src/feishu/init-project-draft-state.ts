export interface InitProjectDraftState {
  projectName: string;
  projectCwd: string;
  gitUrl: string;
  gitToken: string;
  workBranch: string;
  agentsMdContent: string;
  gitignoreContent: string;
}

export const DEFAULT_INIT_AGENTS_MD = `# Project Instructions

- Put only generated artifacts (for example generated images) into \`output/\`
- Do not place source code, docs, configs, or other hand-written files in \`output/\`
`;

export const DEFAULT_INIT_GITIGNORE = `# Project rules
output/

# L3 recommended safe ignore rules
.venv/
venv/
__pycache__/
*.pyc
*.pyo
.eggs/
*.egg-info/
.mypy_cache/
.pytest_cache/
node_modules/
.codex/
.claude/
.opencode/
target/
build/
.gradle/
.DS_Store
Thumbs.db
*.swp
*.swo
*~
`;

function key(chatId: string, userId: string): string {
  return `${chatId}::${userId}`;
}

function createDefaultDraft(): InitProjectDraftState {
  return {
    projectName: "",
    projectCwd: "",
    gitUrl: "",
    gitToken: "",
    workBranch: "",
    agentsMdContent: DEFAULT_INIT_AGENTS_MD,
    gitignoreContent: DEFAULT_INIT_GITIGNORE,
  };
}

const initProjectDraftStore = new Map<string, InitProjectDraftState>();

export function getOrCreateInitProjectDraft(chatId: string, userId: string): InitProjectDraftState {
  const existing = initProjectDraftStore.get(key(chatId, userId));
  if (existing) {
    return { ...existing };
  }
  const created = createDefaultDraft();
  initProjectDraftStore.set(key(chatId, userId), created);
  return { ...created };
}

export function updateInitProjectDraft(
  chatId: string,
  userId: string,
  patch: Partial<InitProjectDraftState>
): InitProjectDraftState {
  const next = { ...getOrCreateInitProjectDraft(chatId, userId), ...patch };
  initProjectDraftStore.set(key(chatId, userId), next);
  return { ...next };
}

export function clearInitProjectDraft(chatId: string, userId: string): void {
  initProjectDraftStore.delete(key(chatId, userId));
}

export function resetInitProjectDraftFile(
  chatId: string,
  userId: string,
  fileKey: "agents_md" | "gitignore"
): InitProjectDraftState {
  return updateInitProjectDraft(chatId, userId, fileKey === "agents_md"
    ? { agentsMdContent: DEFAULT_INIT_AGENTS_MD }
    : { gitignoreContent: DEFAULT_INIT_GITIGNORE });
}
