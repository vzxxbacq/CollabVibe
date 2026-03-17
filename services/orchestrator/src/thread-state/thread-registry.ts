import type { BackendIdentity } from "../../../../packages/agent-core/src/backend-identity";

/**
 * ThreadRecord — project-level, immutable-after-creation thread metadata.
 *
 * Invariants:
 *   - Thread binds to project, not to user
 *   - Thread is immutable (I2): backend identity (backendId, model, transport) fixed at creation
 *   - threadId is the backend-assigned opaque handle (Codex thread UUID or ACP session ID)
 */
export interface ThreadRecord {
    projectId?: string;
    /** @deprecated routing alias only — persistent ownership is projectId */
    chatId?: string;
    threadName: string;
    /** Backend-assigned opaque handle (Codex thread UUID or ACP session ID) */
    threadId: string;
    /** Backend identity — required, immutable after creation */
    backend: BackendIdentity;
}

export type ThreadListEntryStatus = "creating" | "active";

export interface ThreadListEntry {
    projectId: string;
    chatId?: string;
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
    chatId?: string;
    threadName: string;
}

export interface ThreadRegistry {
    /** Reserve a thread name before side effects. Throws if an active/creating thread already exists. */
    reserve(record: Omit<ThreadRecord, "threadId">): ThreadReservation;

    /** Promote a reservation to an active thread after backend thread/session creation succeeds. */
    activate(reservationId: string, record: ThreadRecord): void;

    /** Release a failed/incomplete reservation so the name can be reused later. */
    release(reservationId: string): void;

    /** Register a thread directly (legacy/testing path). Throws if already exists. */
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
}
