export interface ProjectContextRecord {
  id?: string;
  chatId?: string;
  cwd?: string;
  defaultBranch?: string;
  sandbox?: string;
  approvalPolicy?: string;
  status?: string;
}

export interface ProjectResolver {
  findProjectByChatId(chatId: string): ProjectContextRecord | null;
  findProjectById?(projectId: string): ProjectContextRecord | null;
  listActiveProjects?(): ProjectContextRecord[];
}
