import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const docsRoot = path.join(repoRoot, 'docs');
const skipDirs = new Set(['.vitepress', 'public', 'dist', 'node_modules']);
const markdownFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      markdownFiles.push(path.join(dir, entry.name));
    }
  }
}

function fileExistsWithMdFallback(targetPath) {
  if (fs.existsSync(targetPath)) return true;
  if (fs.existsSync(`${targetPath}.md`)) return true;
  if (fs.existsSync(path.join(targetPath, 'index.md'))) return true;
  return false;
}

function resolveDocTarget(fromFile, href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return null;
  if (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('mailto:')) return null;
  if (clean.startsWith('<') || clean.startsWith('javascript:')) return null;
  if (clean.startsWith('/assets/') || clean.startsWith('/@fs/')) return null;

  if (clean.startsWith('/')) {
    const publicTarget = path.join(docsRoot, 'public', clean.slice(1));
    if (fileExistsWithMdFallback(publicTarget)) return publicTarget;
    return path.join(docsRoot, clean.slice(1));
  }

  return path.resolve(path.dirname(fromFile), clean);
}

walk(docsRoot);

const linkRegex = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const errors = [];

for (const file of markdownFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(linkRegex)) {
    const href = match[1];
    if (!href || href.startsWith('#')) continue;
    const target = resolveDocTarget(file, href);
    if (!target) continue;
    if (!fileExistsWithMdFallback(target)) {
      errors.push({
        file: path.relative(repoRoot, file),
        href,
        target: path.relative(repoRoot, target),
      });
    }
  }
}

if (errors.length) {
  console.error(`Broken doc links: ${errors.length}`);
  for (const err of errors) {
    console.error(`- ${err.file}: ${err.href} -> ${err.target}`);
  }
  process.exit(1);
}

console.log(`Doc link check passed: ${markdownFiles.length} markdown files scanned.`);
