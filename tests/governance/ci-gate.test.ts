import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listCoveredGlobs, REQUIRED_TEST_DIRECTORIES } from '../../scripts/test-manifest.mjs';

interface PackageJson {
  scripts: Record<string, string>;
}

function loadPackageJson(): PackageJson {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as PackageJson;
}

describe('ci gate scripts', () => {
  it('has layered and domain test scripts', () => {
    const packageJson = loadPackageJson();

    const requiredScripts = [
      'test',
      'test:logic',
      'test:l0',
      'test:l1',
      'test:l2',
      'test:l3',
      'test:l4',
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
      'test:live:codex',
      'test:live:codex:precheck',
      'report:phase1',
      'report:phase2'
    ];

    for (const scriptName of requiredScripts) {
      expect(packageJson.scripts[scriptName], `${scriptName} missing`).toBeTypeOf('string');
    }
  });

  it('covers every governed test directory through the manifest', () => {
    const coveredGlobs = listCoveredGlobs().join('\n');

    for (const testDir of REQUIRED_TEST_DIRECTORIES) {
      const normalized = testDir.replace(/\/tests$/, '');
      expect(
        coveredGlobs.includes(testDir) || coveredGlobs.includes(normalized),
        `${testDir} is not covered by any test group`
      ).toBe(true);
    }
  });

  it('contains layered CI workflows', () => {
    const phase1 = path.join(process.cwd(), '.github', 'workflows', 'phase1-ci.yml');
    const phase2 = path.join(process.cwd(), '.github', 'workflows', 'phase2-ci.yml');
    expect(fs.existsSync(phase1)).toBe(true);
    expect(fs.existsSync(phase2)).toBe(true);

    const phase1Content = fs.readFileSync(phase1, 'utf8');
    expect(phase1Content).toContain('npm run test:l0');
    expect(phase1Content).toContain('npm run test:l1');
    expect(phase1Content).toContain('npm run test:l2');
    expect(phase1Content).toContain('npm run test:l3');

    const phase2Content = fs.readFileSync(phase2, 'utf8');
    expect(phase2Content).toContain('npm run test:e2e');
    expect(phase2Content).toContain('npm run test:live:codex');
  });

  it('current gate scripts do not allow passWithNoTests', () => {
    const packageJson = loadPackageJson();
    for (const [scriptName, command] of Object.entries(packageJson.scripts)) {
      if (scriptName.startsWith('test') || scriptName.startsWith('report:')) {
        expect(command, `${scriptName} should not contain passWithNoTests`).not.toContain('--passWithNoTests');
      }
    }
  });

  it('keeps shared gate helper scripts and central test manifest', () => {
    const helperPath = path.join(process.cwd(), 'scripts', 'test-module.sh');
    expect(fs.existsSync(helperPath)).toBe(true);
    expect(fs.statSync(helperPath).mode & 0o111).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'test-gate-utils.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'test-manifest.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts', 'run-test-group.mjs'))).toBe(true);
  });
});
