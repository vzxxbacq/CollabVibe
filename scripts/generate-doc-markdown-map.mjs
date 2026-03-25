#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const docsRoot = path.join(repoRoot, "docs");
const outputDir = path.join(docsRoot, ".vitepress", "generated");
const outputFile = path.join(outputDir, "markdown-sources.ts");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === ".vitepress" || entry.name === "public") {
        continue;
      }
      files.push(...walk(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function toRoute(filePath) {
  const relativePath = path.relative(docsRoot, filePath).replaceAll(path.sep, "/");

  if (relativePath === "index.md") {
    return "/";
  }

  if (relativePath === "zh/index.md") {
    return "/zh/";
  }

  return `/${relativePath.slice(0, -3)}`;
}

const routes = Object.fromEntries(
  walk(docsRoot)
    .sort()
    .map((filePath) => [toRoute(filePath), fs.readFileSync(filePath, "utf8")])
);

const fileContents = `export const markdownSourceByRoute = ${JSON.stringify(routes, null, 2)} as const;\n`;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, fileContents);

console.log(`generated ${path.relative(repoRoot, outputFile)}`);
