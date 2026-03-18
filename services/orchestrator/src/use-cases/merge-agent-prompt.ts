import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface BuildMergeAgentPromptInput {
  worktreeCwd: string;
  filePath: string;
  userPrompt?: string;
}

const MAX_FILE_EXCERPT_CHARS = 4000;

export async function buildSingleFileMergeAgentPrompt(
  input: BuildMergeAgentPromptInput
): Promise<string> {
  const fileExcerpt = await readFileExcerpt(input.worktreeCwd, input.filePath);
  const userPrompt = input.userPrompt?.trim();

  return [
    "You are a senior software engineer resolving a single-file git merge conflict.",
    "Your task is to produce the correct merged version of the target file while preserving intended behavior.",
    "",
    "Rules:",
    `- Only modify this file: ${input.filePath}`,
    "- Do not edit any other file.",
    "- Remove all git conflict markers: <<<<<<<, =======, >>>>>>>",
    "- Preserve the file's purpose, public behavior, and useful comments/docstrings.",
    "- Merge both sides when they are compatible; do not drop required behavior just to make the conflict disappear.",
    "- When you finish editing, run git add on the target file and stop.",
    "",
    "What to infer from the file:",
    "- The file excerpt below may contain comments, docstrings, function names, and code structure that explain what this file is for.",
    "- Use that context to decide the correct merged result.",
    "",
    ...(userPrompt ? [
      "Additional user instructions:",
      userPrompt,
      "",
    ] : []),
    "Current target file excerpt:",
    "```",
    fileExcerpt,
    "```",
  ].join("\n");
}

async function readFileExcerpt(worktreeCwd: string, filePath: string): Promise<string> {
  try {
    const content = await readFile(join(worktreeCwd, filePath), "utf8");
    if (content.length <= MAX_FILE_EXCERPT_CHARS) {
      return content;
    }
    return `${content.slice(0, MAX_FILE_EXCERPT_CHARS)}\n... [truncated]`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read merge target file ${filePath}: ${reason}`);
  }
}
