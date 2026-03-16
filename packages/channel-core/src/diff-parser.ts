function normalizePath(input: string): string {
  if (input === "/dev/null" || input === "dev/null") {
    return "/dev/null";
  }
  // Remove surrounding quotes and a/ or b/ prefix
  return input.replace(/^"?(.*?)"?$/, "$1").replace(/^[ab]\//, "");
}

function parsePathToken(line: string): string | null {
  const token = line.trim().split(/\s+/)[1];
  if (!token) {
    return null;
  }
  return normalizePath(token);
}

function resolveChangedPath(oldPath: string | null, newPath: string | null): string | null {
  if (newPath && newPath !== "/dev/null") {
    return newPath;
  }
  if (oldPath && oldPath !== "/dev/null") {
    return oldPath;
  }
  return null;
}

export function parseDiffFileNames(unifiedDiff: string): string[] {
  const files = new Set<string>();
  let pendingOld: string | null = null;
  let pendingNew: string | null = null;

  const finalizePending = () => {
    const resolved = resolveChangedPath(pendingOld, pendingNew);
    if (resolved) {
      files.add(resolved);
    }
    pendingOld = null;
    pendingNew = null;
  };

  for (const line of unifiedDiff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finalizePending();
      // Support quoted paths: diff --git "a/path" "b/path"
      const quotedMatch = line.match(/^diff --git "a\/(.+?)"\s+"b\/(.+?)"$/);
      if (quotedMatch) {
        const resolved = resolveChangedPath(normalizePath(quotedMatch[1]), normalizePath(quotedMatch[2]));
        if (resolved) {
          files.add(resolved);
        }
        continue;
      }
      // Standard unquoted paths
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        const resolved = resolveChangedPath(normalizePath(match[1]), normalizePath(match[2]));
        if (resolved) {
          files.add(resolved);
        }
      }
      continue;
    }
    if (line.startsWith("--- ")) {
      pendingOld = parsePathToken(line);
      continue;
    }
    if (line.startsWith("+++ ")) {
      pendingNew = parsePathToken(line);
      finalizePending();
      continue;
    }
  }

  finalizePending();
  return [...files];
}

export function parseDiffStats(unifiedDiff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of unifiedDiff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}
