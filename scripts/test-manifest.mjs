export const TEST_GROUPS = {
  l0: {
    kind: 'vitest',
    globs: ['tests/governance/*.test.ts']
  },
  l1: {
    kind: 'vitest',
    globs: ['packages/*/tests/unit/**/*.test.ts', 'services/*/tests/unit/**/*.test.ts']
  },
  l2: {
    kind: 'vitest',
    globs: ['packages/*/tests/integration/**/*.test.ts', 'services/*/tests/integration/**/*.test.ts']
  },
  l3: {
    kind: 'vitest',
    globs: ['tests/app/**/*.test.ts']
  },
  l4: {
    kind: 'vitest',
    globs: ['tests/e2e/*.test.ts', 'tests/e2e/**/*.test.ts']
  },
  governance: {
    kind: 'vitest',
    globs: ['tests/governance/*.test.ts']
  },
  app: {
    kind: 'vitest',
    globs: ['tests/app/**/*.test.ts']
  },
  e2e: {
    kind: 'vitest',
    globs: ['tests/e2e/*.test.ts', 'tests/e2e/**/*.test.ts']
  },
  live: {
    kind: 'vitest',
    globs: ['tests/live/*.test.ts', 'tests/live/**/*.test.ts']
  },
  'acp-client': { kind: 'vitest', globs: ['packages/acp-client/tests/**/*.test.ts'] },
  'channel-core': { kind: 'vitest', globs: ['packages/channel-core/tests/**/*.test.ts'] },
  'channel-feishu': { kind: 'vitest', globs: ['packages/channel-feishu/tests/**/*.test.ts'] },
  'codex-client': { kind: 'vitest', globs: ['packages/codex-client/tests/**/*.test.ts'] },
  iam: { kind: 'vitest', globs: ['services/iam/tests/**/*.test.ts'] },
  persistence: { kind: 'vitest', globs: ['services/persistence/tests/**/*.test.ts'] },
  approval: { kind: 'vitest', globs: ['services/approval/tests/**/*.test.ts'] },
  audit: { kind: 'vitest', globs: ['services/audit/tests/**/*.test.ts'] },
  'admin-api': { kind: 'vitest', globs: ['services/admin-api/tests/**/*.test.ts'] },
  orchestrator: { kind: 'vitest', globs: ['services/orchestrator/tests/**/*.test.ts'] },
  plugin: { kind: 'vitest', globs: ['services/plugin/tests/**/*.test.ts'] },
  appflow: { kind: 'vitest', globs: ['tests/app/**/*.test.ts'] }
};

export const REQUIRED_TEST_DIRECTORIES = [
  'tests/governance',
  'tests/app',
  'tests/e2e',
  'tests/live',
  'packages/acp-client/tests',
  'packages/channel-core/tests',
  'packages/channel-feishu/tests',
  'packages/codex-client/tests',
  'services/admin-api/tests',
  'services/approval/tests',
  'services/audit/tests',
  'services/iam/tests',
  'services/orchestrator/tests',
  'services/persistence/tests',
  'services/plugin/tests'
];

export function getGroup(name) {
  const group = TEST_GROUPS[name];
  if (!group) {
    throw new Error(`Unknown test group: ${name}`);
  }
  return group;
}

export function listCoveredGlobs() {
  const globs = [];
  for (const group of Object.values(TEST_GROUPS)) {
    const commands = group.commands ?? [group];
    for (const command of commands) {
      if (command.globs) globs.push(...command.globs);
    }
  }
  return [...new Set(globs)];
}
