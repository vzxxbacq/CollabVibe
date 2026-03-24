import type { OrchestratorApi, ProjectRecord } from "../../services/index";

export async function resolveProjectByChatId(api: OrchestratorApi, chatId: string): Promise<ProjectRecord | null> {
  const projectId = await api.resolveProjectId(chatId);
  if (!projectId) {
    return null;
  }
  return await api.getProjectRecord(projectId);
}
