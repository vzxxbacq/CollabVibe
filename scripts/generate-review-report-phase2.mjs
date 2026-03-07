#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const resultsDir = path.join(rootDir, "tmp", "test-results", "phase2");
const reportPath = path.join(rootDir, "docs", "review", "phase2", "module-test-report.md");
const reportJsonPath = path.join(rootDir, "docs", "review", "phase2", "module-test-report.json");

const moduleRuns = [
  { name: "phase2-logic", script: "test:phase2:logic" },
  { name: "orchestrator-phase2", script: "test:orchestrator:phase2" },
  { name: "approval", script: "test:approval" },
  { name: "audit", script: "test:audit" },
  { name: "admin-api", script: "test:admin-api" },
  { name: "admin-ui", script: "test:admin-ui" },
  { name: "live-codex-precheck", script: "test:live:codex:precheck" }
];

fs.mkdirSync(resultsDir, { recursive: true });

function loadVitestJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function runModuleTest(moduleRun) {
  const outputPath = path.join(resultsDir, `${moduleRun.name}.json`);
  const args = [
    "run",
    moduleRun.script,
    "--",
    "--reporter=json",
    `--outputFile=${outputPath}`
  ];

  const startedAt = Date.now();
  const child = spawnSync("npm", args, {
    cwd: rootDir,
    encoding: "utf8"
  });
  const finishedAt = Date.now();

  const parsed = loadVitestJson(outputPath);
  const success = child.status === 0 && (parsed?.success ?? true);

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
    stdoutTail: (child.stdout || "").split("\n").slice(-8).join("\n").trim(),
    stderrTail: (child.stderr || "").split("\n").slice(-8).join("\n").trim()
  };
}

const runResults = moduleRuns.map(runModuleTest);
const allPassed = runResults.every((result) => result.success);
const totalTests = runResults.reduce((sum, result) => sum + result.summary.totalTests, 0);
const passedTests = runResults.reduce((sum, result) => sum + result.summary.passedTests, 0);
const failedTests = runResults.reduce((sum, result) => sum + result.summary.failedTests, 0);

const markdown = [
  "# Phase2 Module Test Report",
  "",
  `- Generated at: ${new Date().toISOString()}`,
  `- Gate status: ${allPassed ? "PASS" : "FAIL"}`,
  `- Total tests: ${totalTests}`,
  `- Passed tests: ${passedTests}`,
  `- Failed tests: ${failedTests}`,
  "",
  "## Module Results",
  "",
  "| Module | Script | Status | Tests (pass/total) | Failed | Duration(ms) |",
  "|---|---|---|---|---|---|",
  ...runResults.map(
    (result) =>
      `| ${result.name} | ${result.script} | ${result.success ? "PASS" : "FAIL"} | ${result.summary.passedTests}/${result.summary.totalTests} | ${result.summary.failedTests} | ${result.durationMs} |`
  ),
  "",
  "## Failed Module Logs",
  ""
];

const failedModules = runResults.filter((result) => !result.success);
if (failedModules.length === 0) {
  markdown.push("- None");
} else {
  for (const result of failedModules) {
    markdown.push(`### ${result.name}`);
    markdown.push("");
    markdown.push("```text");
    markdown.push(`exitCode: ${result.exitCode}`);
    markdown.push(result.stdoutTail || "<no stdout>");
    if (result.stderrTail) {
      markdown.push("--- stderr ---");
      markdown.push(result.stderrTail);
    }
    markdown.push("```");
    markdown.push("");
  }
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${markdown.join("\n")}\n`, "utf8");
fs.writeFileSync(
  reportJsonPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      allPassed,
      totalTests,
      passedTests,
      failedTests,
      modules: runResults
    },
    null,
    2
  ) + "\n",
  "utf8"
);

if (!allPassed) {
  process.exit(1);
}
