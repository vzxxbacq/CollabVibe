/**
 * Project Pull types — L2 public types for project-level pull alignment.
 *
 * These types define the preview→confirm protocol, thread disposition
 * classification, and result structures for project pull operations.
 */

// ── Pull mode ───────────────────────────────────────────────────────

export type ProjectPullMode = "no_op" | "fast_forward" | "rewrite";

// ── Thread disposition ──────────────────────────────────────────────

export type ProjectPullThreadDisposition =
  | "blocked_active_turn"
  | "blocked_merge_session"
  | "blocked_merge_head_present"
  | "blocked_unknown_state"
  | "auto_fast_forward"
  | "auto_recreate"
  | "manual_stale_diverged"
  | "manual_dirty_worktree"
  | "noop_already_aligned";

export interface ThreadDispositionEntry {
  threadName: string;
  disposition: ProjectPullThreadDisposition;
  /** Present when disposition is blocked_* or manual_* to explain why. */
  reason?: string;
}

// ── Preview result ──────────────────────────────────────────────────

export interface ProjectPullPreviewResult {
  previewId: string;
  projectId: string;
  projectName: string;
  workBranch: string;
  targetRef: string;
  currentHead: string;
  targetHead: string;
  mode: ProjectPullMode;
  /** ISO 8601 expiration timestamp. */
  expiresAt: string;

  hardBlockers: ThreadDispositionEntry[];
  autoUpdates: ThreadDispositionEntry[];
  manualFollowUps: ThreadDispositionEntry[];

  /** true when hardBlockers is empty. */
  canConfirm: boolean;
}

// ── Confirm result ──────────────────────────────────────────────────

export interface ProjectPullConfirmResult {
  projectId: string;
  mode: ProjectPullMode;
  oldHead: string;
  newHead: string;

  autoUpdatedThreads: Array<{
    threadName: string;
    disposition: "auto_fast_forward" | "auto_recreate";
    newBaseSha: string;
  }>;
  /** Threads left as-is for the user to handle. */
  manualFollowUps: ThreadDispositionEntry[];
  /** Non-fatal errors encountered during thread batch updates. */
  errors: Array<{
    threadName: string;
    error: string;
  }>;
}
