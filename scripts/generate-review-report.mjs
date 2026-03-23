#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const resultsDir = path.join(rootDir, 'tmp', 'test-results', 'phase1');
const reportPath = path.join(rootDir, 'docs', 'review', 'phase1', 'module-test-report.md');
const reportJsonPath = path.join(rootDir, 'docs', 'review', 'phase1', 'module-test-report.json');

const moduleRuns = [
  { name: 'l1', script: 'test:l1' },
  { name: 'l2', script: 'test:l2' },
  { name: 'app', script: 'test:app' },
];

fs.mkdirSync(resultsDir, { recursive: true });

function loadVitestJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function runModuleTest(moduleRun) {
  const outputPath = path.join(resultsDir, `${moduleRun.name}.json`);
  const args = ['run', moduleRun.script, '--', '--reporter=json', `--outputFile=${outputPath}`];
  const startedAt = Date.now();
  const child = spawnSync('npm', args, { cwd: rootDir, encoding: 'utf8' });
  const finishedAt = Date.now();
  const parsed = loadVitestJson(outputPath);
  const success = child.status === 0 && Boolean(parsed?.success);

  return {
    name: moduleRun.name,
    script: moduleRun.script,
    success,
    exitCode: child.status ?? 1,
    durationMs: finishedAt - startedAt,
    summary: {
      totalTests: parsed?.numTotalTests ?? 0,
      passedTests: parsed?.numPassedTests ?? 0,
      failedTests: parsed?.numFailedTests ?? 0
    },
    stdoutTail: (child.stdout || '').split('
').slice(-8).join('
').trim(),
    stderrTail: (child.stderr || '').split('
').slice(-8).join('
').trim()
  };
}

const runResults = moduleRuns.map(runModuleTest);
const allPassed = runResults.every((result) => result.success);
const totalTests = runResults.reduce((sum, result) => sum + result.summary.totalTests, 0);
const passedTests = runResults.reduce((sum, result) => sum + result.summary.passedTests, 0);
const failedTests = runResults.reduce((sum, result) => sum + result.summary.failedTests, 0);

const markdown = [
  '# Phase1 Layered Test Report',
  '',
  `- Generated at: ${new Date().toISOString()}`,
  `- Gate status: ${allPassed ? 'PASS' : 'FAIL'}`,
  `- Total tests: ${totalTests}`,
  `- Passed tests: ${passedTests}`,
  `- Failed tests: ${failedTests}`,
  '',
  '## Layer Results',
  '',
  '| Layer | Script | Status | Tests (pass/total) | Failed | Duration(ms) |',
  '|---|---|---|---|---|---|',
  ...runResults.map((result) => `| ${result.name} | ${result.script} | ${result.success ? 'PASS' : 'FAIL'} | ${result.summary.passedTests}/${result.summary.totalTests} | ${result.summary.failedTests} | ${result.durationMs} |`),
  '',
  '## Failed Layer Logs',
  ''
];

const failedModules = runResults.filter((result) => !result.success);
if (failedModules.length === 0) {
  markdown.push('- None');
} else {
  for (const result of failedModules) {
    markdown.push(`### ${result.name}`);
    markdown.push('');
    markdown.push('```text');
    markdown.push(`exitCode: ${result.exitCode}`);
    markdown.push(result.stdoutTail || '<no stdout>');
    if (result.stderrTail) {
      markdown.push('--- stderr ---');
      markdown.push(result.stderrTail);
    }
    markdown.push('```');
    markdown.push('');
  }
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${markdown.join('
')}
`, 'utf8');
fs.writeFileSync(reportJsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), allPassed, totalTests, passedTests, failedTests, modules: runResults }, null, 2) + '
', 'utf8');

if (!allPassed) process.exit(1);
