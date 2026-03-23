export interface ThreadTurnState {
  projectId: string;
  threadName: string;
  activeTurnId?: string;
  blockingTurnId?: string;
  lastCompletedTurnId?: string;
  updatedAt: string;
}
