/**
 * @module services/thread/thread-execution-policy-validator
 *
 * Validates thread execution policy override values.
 * Phase 1: only sandbox and approvalPolicy.
 *
 * No direction validation — maintainer/admin can set any valid value.
 */

import { OrchestratorError, ErrorCode } from "../errors";
import type {
  SandboxLevel,
  ApprovalPolicyLevel,
  ThreadExecutionPolicyOverride,
  ThreadExecutionPolicyCapability,
} from "./thread-execution-policy-types";

// ── Valid value sets ────────────────────────────────────────────────────────

export const VALID_SANDBOX_LEVELS: readonly SandboxLevel[] = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export const VALID_APPROVAL_LEVELS: readonly ApprovalPolicyLevel[] = [
  "untrusted",
  "on-request",
  "never",
] as const;

// ── Phase 1 hardcoded capability (all values allowed) ───────────────────────

export const DEFAULT_CAPABILITY: ThreadExecutionPolicyCapability = {
  allowedSandbox: [...VALID_SANDBOX_LEVELS],
  allowedApprovalPolicies: [...VALID_APPROVAL_LEVELS],
};

// ── Validator ───────────────────────────────────────────────────────────────

/**
 * Validate that an override contains only valid enum values.
 * Throws OrchestratorError with THREAD_POLICY_INVALID_VALUE if invalid.
 */
export function validatePolicyOverride(
  override: ThreadExecutionPolicyOverride,
): void {
  if (override.sandbox !== undefined) {
    if (!(VALID_SANDBOX_LEVELS as readonly string[]).includes(override.sandbox)) {
      throw new OrchestratorError(
        ErrorCode.THREAD_POLICY_INVALID_VALUE,
        `Invalid sandbox value: "${override.sandbox}". Allowed: ${VALID_SANDBOX_LEVELS.join(", ")}`,
      );
    }
  }

  if (override.approvalPolicy !== undefined) {
    if (!(VALID_APPROVAL_LEVELS as readonly string[]).includes(override.approvalPolicy)) {
      throw new OrchestratorError(
        ErrorCode.THREAD_POLICY_INVALID_VALUE,
        `Invalid approvalPolicy value: "${override.approvalPolicy}". Allowed: ${VALID_APPROVAL_LEVELS.join(", ")}`,
      );
    }
  }
}

/**
 * Validate that an override is non-empty (at least one field set).
 */
export function validateNonEmptyOverride(
  override: ThreadExecutionPolicyOverride,
): void {
  if (override.sandbox === undefined && override.approvalPolicy === undefined) {
    throw new OrchestratorError(
      ErrorCode.THREAD_POLICY_INVALID_VALUE,
      "At least one policy field (sandbox or approvalPolicy) must be specified",
    );
  }
}
