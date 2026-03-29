/**
 * @module services/thread/thread-execution-policy-types
 *
 * Thread-level execution policy override types (Phase 1: sandbox + approvalPolicy).
 *
 * These types define the override mechanism that allows maintainer/admin users
 * to customize sandbox and approval policies at the thread level.
 *
 * Value domains:
 *   - SandboxLevel:        "read-only" | "workspace-write" | "danger-full-access"
 *   - ApprovalPolicyLevel: "untrusted" | "on-request" | "never"
 *
 * Both are compatible with:
 *   - Codex: SandboxMode + AskForApproval (generated v2 types)
 *   - ACP:   transparent passthrough via sessionNew()
 */

// ── Value domain enums ──────────────────────────────────────────────────────

export type SandboxLevel = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicyLevel = "untrusted" | "on-request" | "never";

// ── Thread-level override (only these two fields in Phase 1) ────────────────

export interface ThreadExecutionPolicyOverride {
  sandbox?: SandboxLevel;
  approvalPolicy?: ApprovalPolicyLevel;
}

// ── Capability DTO (Phase 1: hardcoded at L2, no L3 query) ──────────────────

export interface ThreadExecutionPolicyCapability {
  allowedSandbox: SandboxLevel[];
  allowedApprovalPolicies: ApprovalPolicyLevel[];
}

// ── View DTO (returned by getThreadExecutionPolicy) ─────────────────────────

export interface ThreadExecutionPolicyView {
  threadName: string;
  /** Project-level policy (from ProjectRecord) */
  projectPolicy: { sandbox: string; approvalPolicy: string };
  /** Thread-level override (from ThreadRecord.executionPolicyOverride) */
  override: ThreadExecutionPolicyOverride;
  /** Final resolved values (override ?? project-level) */
  resolved: { sandbox: string; approvalPolicy: string };
  /** Allowed values for this backend */
  capability: ThreadExecutionPolicyCapability;
}

// ── Preview DTO (returned by previewThreadExecutionPolicyUpdate) ─────────────

export interface ThreadExecutionPolicyPreview {
  threadName: string;
  current: { sandbox: string; approvalPolicy: string };
  requested: ThreadExecutionPolicyOverride;
  /** What the resolved values would become after applying the override */
  resolved: { sandbox: string; approvalPolicy: string };
}

// ── Confirm result DTO ──────────────────────────────────────────────────────

export interface ThreadExecutionPolicyConfirmResult {
  threadName: string;
  applied: ThreadExecutionPolicyOverride;
  resolved: { sandbox: string; approvalPolicy: string };
}
