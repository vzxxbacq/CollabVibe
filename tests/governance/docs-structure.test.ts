import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REQUIRED_DOC_FILES = [
  'docs/index.md',
  'docs/.vitepress/config.mts',
  'docs/00-overview/project-intro.md',
  'docs/00-overview/system-overview.md',
  'docs/01-architecture/invariants.md',
  'docs/01-architecture/data-paths.md',
  'docs/02-operations/deployment.md',
  'docs/02-operations/data-and-storage.md',
  'docs/03-development/local-development.md',
  'docs/03-development/testing.md'
];

describe('docs structure', () => {
  it('contains the documentation site skeleton plus core ops and development guides', () => {
    for (const file of REQUIRED_DOC_FILES) {
      const fullPath = path.join(process.cwd(), file);
      expect(fs.existsSync(fullPath), `missing ${file}`).toBe(true);
    }
  });
});
