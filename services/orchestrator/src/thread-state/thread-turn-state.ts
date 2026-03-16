export interface ThreadTurnState {
  projectId?: string;
  /** @deprecated routing alias only — persistent ownership is projectId */
  chatId?: string;
  threadName: string;
  activeTurnId?: string;
  blockingTurnId?: string;
  lastCompletedTurnId?: string;
  updatedAt: string;
}
