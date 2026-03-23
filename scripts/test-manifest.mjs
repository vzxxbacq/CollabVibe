export const TEST_GROUPS = {
  l1: {
    kind: 'vitest',
    globs: ['packages/agent-core/tests/unit', 'packages/git-utils/tests/unit']
  },
  l2: {
    kind: 'vitest',
    globs: ['services/tests/unit', 'services/tests/sim']
  },
  app: {
    kind: 'vitest',
    config: 'vitest.admin-ui.config.ts',
    globs: ['packages/admin-ui/tests/integration']
  },
  orchestrator: {
    kind: 'vitest',
    globs: ['services/tests/unit', 'services/tests/sim']
  }
};

export const REQUIRED_TEST_DIRECTORIES = [
  'packages/agent-core/tests/unit',
  'packages/git-utils/tests/unit',
  'packages/admin-ui/tests/integration',
  'services/tests/unit',
  'services/tests/sim'
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
