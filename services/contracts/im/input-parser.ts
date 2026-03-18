/**
 * Shared input parsing utilities — used by all IM platform layers.
 * @module channel-core/input-parser
 */

/**
 * Regex: matches @path/to/file.ext or @file:path/to/file.ext
 * - Requires a `.ext` suffix (1-10 chars) to avoid matching @user_123
 * - `file:` prefix is optional
 */
const FILE_MENTION_REGEX = /@(?:file:)?(\S+\.\w{1,10})/g;

export interface FileMentionResult {
  /** Text with @file mentions removed */
  cleanedText: string;
  /** Extracted file paths */
  files: string[];
}

/**
 * Extract @file:path mentions from text.
 *
 * Syntax:
 * - `@src/foo.ts` → extracts `src/foo.ts`
 * - `@file:packages/core/types.ts` → extracts `packages/core/types.ts`
 * - Does NOT match `@user_123` (no `.ext` suffix)
 */
export function extractFileMentions(text: string): FileMentionResult {
  const files: string[] = [];
  const cleanedText = text
    .replace(FILE_MENTION_REGEX, (_, path: string) => {
      files.push(path);
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { cleanedText, files };
}
