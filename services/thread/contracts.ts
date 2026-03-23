import type { BackendIdentity } from "../../packages/agent-core/src/index";
import type { ThreadRecord } from "./types";

export type ThreadListEntryStatus = "creating" | "active";

export interface ThreadListEntry {
  projectId: string;
  threadName: string;
  /**
   * `active` entries carry the backend-assigned opaque thread/session id.
   * `creating` entries are reservations and do not expose a stable backend id yet.
   */
  threadId?: string;
  status: ThreadListEntryStatus;
  backend: BackendIdentity;
}

export interface ThreadReservation {
  reservationId: string;
  projectId: string;
  threadName: string;
}

export interface ThreadRegistry {
  /** Reserve a thread name before side effects. Throws if an active/creating thread already exists. */
  reserve(record: Omit<ThreadRecord, "threadId">): ThreadReservation;

  /** Promote a reservation to an active thread after backend thread/session creation succeeds. */
  activate(reservationId: string, record: ThreadRecord): void;

  /** Release a failed/incomplete reservation so the name can be reused later. */
  release(reservationId: string): void;

  /** Register a thread directly (testing path). Throws if already exists. */
  register(record: ThreadRecord): void;

  /** Lookup a thread by projectId + threadName */
  get(projectId: string, threadName: string): ThreadRecord | null;

  /** List all threads in a project */
  list(projectId: string): ThreadRecord[];

  /** List visible thread rows in a project, including creating reservations. */
  listEntries?(projectId: string): ThreadListEntry[];

  /** List ALL active threads across all projects (for startup recovery) */
  listAll?(): ThreadRecord[];

  /** Remove a thread (after merge+delete) */
  remove(projectId: string, threadName: string): void;

  /** Update mutable runtime fields (baseSha, hasDiverged, worktreePath) on an existing thread */
  update?(projectId: string, threadName: string, patch: Partial<Pick<ThreadRecord, "baseSha" | "hasDiverged" | "worktreePath">>): void;

  /**
   * Replace the backend-assigned thread id for an empty thread before any
   * completed turn exists. This is intentionally narrow and must not be used
   * for threads with persisted conversation history.
   */
  replaceEmptyThreadId?(params: {
    projectId: string;
    threadName: string;
    oldThreadId: string;
    newThreadId: string;
    backend: BackendIdentity;
  }): void;
}
