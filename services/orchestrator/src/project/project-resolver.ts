import type { ProjectRecord } from "../../../contracts/admin/admin-state";

export interface ProjectResolver {
  findProjectByChatId(chatId: string): ProjectRecord | null;
  findProjectById?(projectId: string): ProjectRecord | null;
  listActiveProjects?(): ProjectRecord[];
}
