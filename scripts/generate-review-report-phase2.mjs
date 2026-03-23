#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { assertNonZeroTests } from './test-gate-utils.mjs';

const rootDir = process.cwd();
const resultsDir = path.join(rootDir, 'tmp', 'test-results', 'phase2');
const reviewDir = path.join(rootDir, 'docs', 'review', 'phase2');
const reportPath = path.join(reviewDir, 'module-test-report.md');
const reportJsonPath = path.join(reviewDir, 'module-test-report.json');
const liveReportPath = path.join(reviewDir, 'live-codex-report.md');

const moduleRuns = [
  { name: 'l0', script: 'test:l0', type: 'vitest', group: 'logic' },
  { name: 'l1', script: 'test:l1', type: 'vitest', group: 'logic' },
  { name: 'l2', script: 'test:l2', type: 'vitest', group: 'logic' },
  { name: 'l3', script: 'test:l3', type: 'vitest', group: 'logic' },
  { name: 'e2e', script: 'test:e2e', type: 'vitest', group: 'integration' },
  { name: 'live-codex', script: 'test:live:codex', type: 'command', group: 'live' }
];

fs.mkdirSync(resultsDir, { recursive: true });

function loadVitestJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseJsonFromOutput(stdout, stderr) {
  const combined = [stdout, stderr].filter(Boolean).join('
').trim();
  if (combined) {
    try { return JSON.parse(combined); } catch {}
    const firstBrace = combined.indexOf('{');
    const lastBrace = combined.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try { return JSON.parse(combined.slice(firstBrace, lastBrace + 1)); } catch {}
    }
  }
  const candidates = [stdout, stderr].flatMap((value) => (value || '').split('
')).map((line) => line.trim()).filter(Boolean);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(candidates[index]); } catch {}
  }
  return null;
}

function runModuleTest(moduleRun) {
  const startedAt = Date.now();
  let child;
  let parsed;
  if (moduleRun.type === 'vitest') {
    const outputPath = path.join(resultsDir, `${moduleRun.name}.json`);
    child = spawnSync('npm', ['run', moduleRun.script, '--', '--reporter=json', `--outputFile=${outputPath}`], { cwd: rootDir, encoding: 'utf8' });
    parsed = loadVitestJson(outputPath);
  } else {
    const liveOutputPath = path.join(resultsDir, `${moduleRun.name}.live.json`);
    child = spawnSync('npm', ['run', moduleRun.script], {
      cwd: rootDir,
      encoding: 'utf8',
      env: { ...process.env, LIVE_CODEX_REPORT_PATH: liveOutputPath }
    });
    parsed = parseJsonFromOutput(child.stdout, child.stderr);
    if (!parsed && fs.existsSync(liveOutputPath)) {
      parsed = JSON.parse(fs.readFileSync(liveOutputPath, 'utf8'));
    }
  }
  const finishedAt = Date.now();
  let summary = {
    totalTests: parsed?.numTotalTests ?? 0,
    passedTests: parsed?.numPassedTests ?? 0,
    failedTests: parsed?.numFailedTests ?? 0
  };
  if (moduleRun.type === 'command') {
    const ok = Boolean(parsed?.ok);
    summary = { totalTests: 1, passedTests: ok ? 1 : 0, failedTests: ok ? 0 : 1 };
  }
  const success = child.status === 0 && (moduleRun.type === 'vitest' ? Boolean(parsed?.success) : Boolean(parsed?.ok));
  return {
    name: moduleRun.name,
    script: moduleRun.script,
    group: moduleRun.group,
    type: moduleRun.type,
    success,
    exitCode: child.status ?? 1,
    durationMs: finishedAt - startedAt,
    summary,
    parsedOutput: moduleRun.type === 'command' ? parsed : undefined,
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
assertNonZeroTests(runResults, runResults.filter((result) => result.group !== 'live').map((result) => result.name));
const totalTests = runResults.reduce((sum, result) => sum + result.summary.totalTests, 0);
const passedTests = runResults.reduce((sum, result) => sum + result.summary.passedTests, 0);
const failedTests = runResults.reduce((sum, result) => sum + result.summary.failedTests, 0);

const markdown = [
  '# Phase2 Layered Test Report',
  '',
  `- Generated at: ${new Date().toISOString()}`,
  `- Gate status: ${allPassed ? 'PASS' : 'FAIL'}`,
  `- Total tests: ${totalTests}`,
  `- Passed tests: ${passedTests}`,
  `- Failed tests: ${failedTests}`,
  '',
  '## Layer Results',
  '',
  '| Layer | Group | Script | Status | Tests (pass/total) | Failed | Duration(ms) |',
  '|---|---|---|---|---|---|---|',
  ...runResults.map((result) => `| ${result.name} | ${result.group} | ${result.script} | ${result.success ? 'PASS' : 'FAIL'} | ${result.summary.passedTests}/${result.summary.totalTests} | ${result.summary.failedTests} | ${result.durationMs} |`),
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

const liveResult = runResults.find((result) => result.name === 'live-codex');
const liveMarkdown = [
  '# Live Codex Report',
  '',
  `- Generated at: ${new Date().toISOString()}`,
  `- Status: ${liveResult?.success ? 'PASS' : 'FAIL'}`,
  `- Script: ${liveResult?.script ?? 'test:live:codex'}`,
  ''
];
if (liveResult?.parsedOutput) {
  liveMarkdown.push('```json');
  liveMarkdown.push(JSON.stringify(liveResult.parsedOutput, null, 2));
  liveMarkdown.push('```');
} else {
  liveMarkdown.push('```text');
  liveMarkdown.push(liveResult?.stdoutTail || liveResult?.stderrTail || '<no live output>');
  liveMarkdown.push('```');
}

fs.mkdirSync(reviewDir, { recursive: true });
fs.writeFileSync(reportPath, `${markdown.join('
')}
`, 'utf8');
fs.writeFileSync(liveReportPath, `${liveMarkdown.join('
')}
`, 'utf8');
fs.writeFileSync(reportJsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), allPassed, totalTests, passedTests, failedTests, modules: runResults }, null, 2)}
`, 'utf8');
if (!allPassed) process.exit(1);
