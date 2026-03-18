#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { getGroup } from './test-manifest.mjs';

const [groupName, ...forwardedArgs] = process.argv.slice(2);
if (!groupName) {
  console.error('usage: node scripts/run-test-group.mjs <group> [vitest args...]');
  process.exit(1);
}

const shellQuote = (value) => /[*?\[\]]/.test(String(value)) ? String(value) : `'${String(value).replace(/'/g, `'"'"'`)}'`;
const group = getGroup(groupName);
const commands = group.commands ?? [group];

for (const command of commands) {
  if (command.kind !== 'vitest') {
    console.error(`Unsupported test command kind: ${command.kind}`);
    process.exit(1);
  }

  const parts = ['npx', 'vitest', 'run'];
  if (command.config) {
    parts.push('--config', command.config);
  }
  parts.push(...command.globs, ...forwardedArgs);
  const child = spawnSync('bash', ['-lc', parts.map(shellQuote).join(' ')], {
    stdio: 'inherit',
    env: process.env
  });

  if (child.status !== 0) {
    process.exit(child.status ?? 1);
  }
}
