export interface MergeLogContext {
  traceId?: string;
  chatId?: string;
  userId?: string;
  threadId?: string;
  turnId?: string;
  branchName?: string;
  resolverName?: string;
  worktreePath?: string;
  filePath?: string;
  [key: string]: unknown;
}
