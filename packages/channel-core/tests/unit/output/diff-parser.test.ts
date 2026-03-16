import { describe, expect, it } from "vitest";

import { parseDiffFileNames, parseDiffStats } from "../../../src/diff-parser";

describe("diff-parser", () => {
  it("extracts files from multi-file unified diff", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1 +1,2 @@",
      "+line2"
    ].join("\n");

    expect(parseDiffFileNames(diff)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parseDiffStats(diff)).toEqual({ additions: 2, deletions: 1 });
  });

  it("handles add/delete/rename formats", () => {
    const diff = [
      "diff --git a/dev/null b/src/new.ts",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1 @@",
      "+new file",
      "diff --git a/src/old.ts b/dev/null",
      "--- a/src/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-removed",
      "diff --git a/src/name-old.ts b/src/name-new.ts",
      "--- a/src/name-old.ts",
      "+++ b/src/name-new.ts",
      "@@ -1 +1 @@",
      "-foo",
      "+bar"
    ].join("\n");

    expect(parseDiffFileNames(diff)).toEqual(["src/new.ts", "src/old.ts", "src/name-new.ts"]);
    expect(parseDiffStats(diff)).toEqual({ additions: 2, deletions: 2 });
  });

  it("[C9c-2] parses newly added file from /dev/null header", () => {
    const diff = ["--- /dev/null", "+++ b/new.ts", "@@ -0,0 +1 @@", "+const a = 1;"].join("\n");
    expect(parseDiffFileNames(diff)).toEqual(["new.ts"]);
  });

  it("[C9c-3] parses deleted file when +++ points to /dev/null", () => {
    const diff = ["--- a/old.ts", "+++ /dev/null", "@@ -1 +0,0 @@", "-const a = 1;"].join("\n");
    expect(parseDiffFileNames(diff)).toEqual(["old.ts"]);
  });

  it("[C9c-5] returns empty list for empty diff string", () => {
    expect(parseDiffFileNames("")).toEqual([]);
    expect(parseDiffStats("")).toEqual({ additions: 0, deletions: 0 });
  });

  it("[C9c-6] parses file names from plain ---/+++ headers without diff --git line", () => {
    const diff = ["--- a/foo.ts", "+++ b/foo.ts", "@@ -1 +1 @@", "+line"].join("\n");
    expect(parseDiffFileNames(diff)).toEqual(["foo.ts"]);
  });
});
