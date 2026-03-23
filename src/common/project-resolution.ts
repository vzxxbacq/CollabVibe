import type { OrchestratorApi, ProjectRecord } from "../../services/index";

export function resolveProjectByChatId(api: OrchestratorApi, chatId: string): ProjectRecord | null {
  const projectId = api.resolveProjectId(chatId);
  if (!projectId) {
    return null;
  }
  return api.getProjectRecord(projectId);
}
