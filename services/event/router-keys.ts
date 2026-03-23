export function projectThreadRouteKey(projectId: string, threadName: string): string {
  return `${projectId}:${threadName}`;
}
