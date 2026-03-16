#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const forwardedArgs = process.argv.slice(2);
const testFiles = ['tests/governance/ci-gate.test.ts'];

const child = spawnSync('npx', ['vitest', 'run', ...testFiles, ...forwardedArgs], {
  stdio: 'inherit'
});

if (typeof child.status === 'number') {
  process.exit(child.status);
}

process.exit(1);
