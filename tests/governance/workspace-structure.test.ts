import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REQUIRED_TEST_DIRECTORIES } from '../../scripts/test-manifest.mjs';

const REQUIRED_DIRS = [
  'packages/acp-client',
  'packages/agent-core',
  'packages/channel-core',
  'packages/channel-feishu',
  'packages/codex-client',
  'services/admin-api',
  'services/approval',
  'services/audit',
  'services/iam',
  'services/orchestrator',
  'services/persistence',
  'services/plugin',
  'tests/governance',
  'tests/app',
  'tests/e2e',
  'tests/live'
];

describe('workspace structure', () => {
  it('contains the expected module and top-level test directories', () => {
    for (const dir of REQUIRED_DIRS) {
      const fullPath = path.join(process.cwd(), dir);
      expect(fs.existsSync(fullPath), `missing ${dir}`).toBe(true);
    }
  });

  it('tracks every governed test directory in the manifest', () => {
    for (const dir of REQUIRED_TEST_DIRECTORIES) {
      const fullPath = path.join(process.cwd(), dir);
      expect(fs.existsSync(fullPath), `missing governed test dir ${dir}`).toBe(true);
    }
  });
});
