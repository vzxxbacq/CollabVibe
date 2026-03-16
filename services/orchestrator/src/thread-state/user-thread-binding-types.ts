/**
 * UserThreadBinding — per-user pointer to their active thread.
 *
 * This is a PURE POINTER — it does NOT store backend metadata.
 * Backend identity (backendId, model, transport) lives in ThreadRegistry only.
 */
export interface UserThreadBinding {
  projectId?: string;
  /** @deprecated routing alias only — persistent ownership is projectId */
  chatId?: string;
  userId: string;
  threadName: string;
  threadId: string;
}

export interface UserThreadBindingRepository {
  bind(binding: UserThreadBinding): Promise<void>;
  resolve(projectId: string, userId: string): Promise<UserThreadBinding | null>;
  leave(projectId: string, userId: string): Promise<void>;
}
