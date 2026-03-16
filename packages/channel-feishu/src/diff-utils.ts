/**
 * @module packages/channel-feishu/src/diff-utils
 *
 * Pure utility functions for parsing and formatting Git unified diffs.
 * Zero dependencies — all functions are stateless and side-effect-free.
 *
 * Extracted from FeishuOutputAdapter to improve cohesion.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface DiffFileSummary {
  file: string;
  status: "new" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

/** 单个文件的 diff 片段 */
export interface DiffFileSegment {
  file: string;
  status: "new" | "modified" | "deleted";
  additions: number;
  deletions: number;
  content: string;   // 清理后的 diff 内容
}

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * 解码 Git 八进制转义路径。
 * Git 默认对非 ASCII 文件名使用 `core.quotePath=true`，
 * 输出如 `"\\350\\257\\246\\347\\273\\206\\347\\211\\210.md"` 的格式。
 */
export function unquoteGitPath(raw: string): string {
  // 去除外层引号
  const s = raw.replace(/^"(.*)"$/, "$1");
  // 快速路径：无 \NNN 八进制转义时直接返回（避免破坏已有的 UTF-8 字符）
  if (!s.includes("\\")) {
    return s;
  }
  // 解码 \NNN 八进制转义序列为 UTF-8 字节
  const bytes: number[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\" && i + 3 < s.length && /^[0-3][0-7]{2}$/.test(s.slice(i + 1, i + 4))) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 4;
    } else {
      // ASCII 字符直接转为字节（仅安全于 0-127）
      const code = s.charCodeAt(i);
      if (code < 128) {
        bytes.push(code);
      } else {
        // 非 ASCII 字符不应出现在含转义的路径中（混合格式），
        // 用 TextEncoder 正确编码为 UTF-8 字节
        const encoded = new TextEncoder().encode(s[i]!);
        for (const b of encoded) bytes.push(b);
      }
      i += 1;
    }
  }
  try {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  } catch {
    return s;
  }
}

/** 从 diff --git 头部行提取文件名（支持引号和非引号格式） */
function extractFileFromDiffHeader(headerLine: string): string {
  // 引号格式: "a/path" "b/path"  或  "a/\350..." "b/\350..."
  const quotedMatch = headerLine.match(/"[ab]\/(.+?)"\s+"[ab]\/(.+?)"/);
  if (quotedMatch) {
    return unquoteGitPath(quotedMatch[2] ?? quotedMatch[1] ?? "unknown");
  }
  // 非引号格式: a/path b/path
  const plainMatch = headerLine.match(/[ab]\/(.+)\s+[ab]\/(.+)/);
  if (plainMatch) {
    return unquoteGitPath(plainMatch[2] ?? plainMatch[1] ?? "unknown");
  }
  return "unknown";
}

/** 从 unified diff 解析 per-file 摘要 */
export function parseDiffFiles(raw: string): DiffFileSummary[] {
  const files: DiffFileSummary[] = [];
  const diffSegments = raw.split(/^diff --git /m).filter(Boolean);

  for (const seg of diffSegments) {
    const lines = seg.split("\n");
    const file = extractFileFromDiffHeader(lines[0] ?? "");

    // 跳过非 diff 内容段（如 --stat 输出混入时产生的空段）
    if (file === "unknown" && !seg.includes("--- ") && !seg.includes("+++ ")) {
      continue;
    }

    // 判断状态
    const isNew = seg.includes("new file mode") || seg.includes("--- /dev/null");
    const isDeleted = seg.includes("deleted file mode") || seg.includes("+++ /dev/null");
    const status: "new" | "modified" | "deleted" = isNew ? "new" : isDeleted ? "deleted" : "modified";

    // 统计 +/- 行数 (只计 hunk 内的行，跳过 --- +++ 头)
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith("@@")) { inHunk = true; continue; }
      if (!inHunk) continue;
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
      else if (!line.startsWith(" ") && !line.startsWith("\\")) inHunk = false;
    }

    files.push({ file, status, additions, deletions });
  }
  return files;
}

/**
 * 将合并 diff 拆分为 per-file 段, 每段包含清理后的 diff 内容。
 * 用于分文件折叠展示。
 */
export function splitDiffByFile(raw: string): DiffFileSegment[] {
  const segments: DiffFileSegment[] = [];
  const diffSegments = raw.split(/^diff --git /m).filter(Boolean);

  for (const seg of diffSegments) {
    const lines = seg.split("\n");
    const file = extractFileFromDiffHeader(lines[0] ?? "");
    if (file === "unknown" && !seg.includes("--- ") && !seg.includes("+++ ")) {
      continue;
    }

    const isNew = seg.includes("new file mode") || seg.includes("--- /dev/null");
    const isDeleted = seg.includes("deleted file mode") || seg.includes("+++ /dev/null");
    const status: "new" | "modified" | "deleted" = isNew ? "new" : isDeleted ? "deleted" : "modified";

    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith("@@")) { inHunk = true; continue; }
      if (!inHunk) continue;
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
      else if (!line.startsWith(" ") && !line.startsWith("\\")) inHunk = false;
    }

    // 清理 diff 内容 — 只保留 hunk 头和变更行
    const cleaned = lines.filter((line) =>
      !line.startsWith("index ") &&
      !line.startsWith("new file mode") &&
      !line.startsWith("deleted file mode") &&
      !line.startsWith("old mode") &&
      !line.startsWith("new mode") &&
      !line.startsWith("similarity index") &&
      !line.startsWith("--- ") &&
      !line.startsWith("+++ ") &&
      !(/^[ab]\//.test(line) || /^"[ab]\//.test(line))  // 跳过 diff header 残留
    ).join("\n").trim();

    segments.push({ file, status, additions, deletions, content: cleaned });
  }
  return segments;
}

/** 清理 unified diff — 去掉索引行，保留文件头和实际变更内容 */
export function cleanDiff(raw: string): string {
  return raw.split("\n")
    .filter((line) =>
      !line.startsWith("index ") &&
      !line.startsWith("new file mode") &&
      !line.startsWith("deleted file mode") &&
      !line.startsWith("old mode") &&
      !line.startsWith("new mode") &&
      !line.startsWith("similarity index") &&
      !line.startsWith("diff --git ") &&
      !line.startsWith("--- ") &&
      !line.startsWith("+++ ") &&
      !line.match(/^@@\s/)
    )
    .join("\n");
}

/** 格式化文件列表为树状摘要 */
export function formatFileTree(files: DiffFileSummary[]): string {
  return files.map((f, i) => {
    const prefix = i === files.length - 1 ? "└──" : "├──";
    const tag = f.status === "new" ? "NEW" : f.status === "deleted" ? "DEL" : "MOD";
    const stats = `+${f.additions}/-${f.deletions}`;
    return `${prefix} ${f.file}  \`[${tag} ${stats}]\``;
  }).join("\n");
}
