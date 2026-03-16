const COVERAGE_GUARD_PREFIXES = [
  'test',
  'test:l0',
  'test:l1',
  'test:l2',
  'test:l3',
  'test:l4',
  'test:logic',
  'test:workspace',
  'test:ci-gate',
  'test:app',
  'test:e2e',
  'test:acp-client',
  'test:channel-core',
  'test:channel-feishu',
  'test:codex-client',
  'test:orchestrator',
  'test:approval',
  'test:audit',
  'test:iam',
  'test:persistence',
  'test:admin-api',
  'test:plugin',
  'report:phase1',
  'report:phase2'
];

export function getCoverageGuardScriptEntries(scripts) {
  return Object.entries(scripts).filter(([name]) =>
    COVERAGE_GUARD_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}:`))
  );
}

export function getPhase2ScriptEntries(scripts) {
  return getCoverageGuardScriptEntries(scripts);
}

export function assertNoPassWithNoTests(scriptEntries) {
  for (const [name, command] of scriptEntries) {
    if (command.includes('--passWithNoTests')) {
      throw new Error(`Coverage-guard script ${name} must not use --passWithNoTests`);
    }
  }
}

export function assertNonZeroTests(moduleResults, moduleNames) {
  for (const moduleName of moduleNames) {
    const target = moduleResults.find((result) => result.name === moduleName);
    if (!target) {
      throw new Error(`Missing module result: ${moduleName}`);
    }
    if ((target.summary?.totalTests ?? 0) <= 0) {
      throw new Error(`Module ${moduleName} has zero tests`);
    }
  }
}
