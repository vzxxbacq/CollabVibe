/**
 * @module services/thread/thread-execution-policy-service
 *
 * Service for viewing and modifying thread-level execution policies.
 * Phase 1: sandbox + approvalPolicy only.
 *
 * Permission enforcement (config.write → maintainer/admin only) is handled
 * by the API Guard layer. This service handles state validation
 * (active turn, merge resolver, etc.) and persistence.
 */

import { createLogger } from "../../packages/logger/src/index";
import { OrchestratorError, ErrorCode } from "../errors";
import type { ProjectResolver } from "../project/project-resolver";
import type { ThreadService } from "./thread-service";
import type { AuditService } from "../audit/audit-service";
import {
  validatePolicyOverride,
  validateNonEmptyOverride,
  DEFAULT_CAPABILITY,
} from "./thread-execution-policy-validator";
import type {
  ThreadExecutionPolicyOverride,
  ThreadExecutionPolicyView,
  ThreadExecutionPolicyPreview,
  ThreadExecutionPolicyConfirmResult,
} from "./thread-execution-policy-types";

const log = createLogger("thread-exec-policy");

/**
 * Minimal interface to release cached backend API sessions.
 * Injected to avoid tight coupling to ThreadRuntimeService.
 */
export interface ThreadReleaser {
  releaseThread(projectId: string, threadName: string): Promise<void>;
}

export class ThreadExecutionPolicyService {
  constructor(
    private readonly threadService: ThreadService,
    private readonly projectResolver: ProjectResolver,
    private readonly auditService?: AuditService,
    private readonly threadReleaser?: ThreadReleaser,
  ) {}

  /**
   * Get the current execution policy view for a thread.
   */
  async getPolicy(
    projectId: string,
    threadName: string,
  ): Promise<ThreadExecutionPolicyView> {
    const record = await this.threadService.getRecord(projectId, threadName);
    if (!record) {
      throw new OrchestratorError(ErrorCode.THREAD_NOT_FOUND, `thread not found: ${threadName}`);
    }

    const project = await this.projectResolver.findProjectById?.(projectId);
    if (!project) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found: ${projectId}`);
    }

    const projectPolicy = {
      sandbox: project.sandbox ?? "",
      approvalPolicy: project.approvalPolicy ?? "",
    };

    const override = record.executionPolicyOverride ?? {};

    const resolved = {
      sandbox: override.sandbox ?? projectPolicy.sandbox,
      approvalPolicy: override.approvalPolicy ?? projectPolicy.approvalPolicy,
    };

    return {
      threadName,
      projectPolicy,
      override,
      resolved,
      capability: DEFAULT_CAPABILITY,
    };
  }

  /**
   * Preview a thread execution policy update.
   * Validates values and checks thread state (no active/blocking turns).
   */
  async previewUpdate(
    projectId: string,
    threadName: string,
    requested: ThreadExecutionPolicyOverride,
  ): Promise<ThreadExecutionPolicyPreview> {
    // Validate input values
    validateNonEmptyOverride(requested);
    validatePolicyOverride(requested);

    // Check thread exists
    const record = await this.threadService.getRecord(projectId, threadName);
    if (!record) {
      throw new OrchestratorError(ErrorCode.THREAD_NOT_FOUND, `thread not found: ${threadName}`);
    }

    // Check no active/blocking turn
    await this.guardNoActiveTurn(projectId, threadName);

    // Resolve project policy
    const project = await this.projectResolver.findProjectById?.(projectId);
    if (!project) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found: ${projectId}`);
    }

    const currentOverride = record.executionPolicyOverride ?? {};
    const current = {
      sandbox: currentOverride.sandbox ?? project.sandbox ?? "",
      approvalPolicy: currentOverride.approvalPolicy ?? project.approvalPolicy ?? "",
    };

    // Merge: only requested fields change, others keep current
    const resolved = {
      sandbox: requested.sandbox ?? current.sandbox,
      approvalPolicy: requested.approvalPolicy ?? current.approvalPolicy,
    };

    return {
      threadName,
      current,
      requested,
      resolved,
    };
  }

  /**
   * Confirm a thread execution policy update.
   * Re-validates everything (does NOT trust preview cache), then persists.
   */
  async confirmUpdate(
    projectId: string,
    threadName: string,
    override: ThreadExecutionPolicyOverride,
    actorId: string,
  ): Promise<ThreadExecutionPolicyConfirmResult> {
    // Re-validate (do not trust preview)
    validateNonEmptyOverride(override);
    validatePolicyOverride(override);

    const record = await this.threadService.getRecord(projectId, threadName);
    if (!record) {
      throw new OrchestratorError(ErrorCode.THREAD_NOT_FOUND, `thread not found: ${threadName}`);
    }

    await this.guardNoActiveTurn(projectId, threadName);

    const project = await this.projectResolver.findProjectById?.(projectId);
    if (!project) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found: ${projectId}`);
    }

    // Merge with existing override: only update fields that are specified
    const existingOverride = record.executionPolicyOverride ?? {};
    const merged: ThreadExecutionPolicyOverride = {
      ...existingOverride,
      ...(override.sandbox !== undefined ? { sandbox: override.sandbox } : {}),
      ...(override.approvalPolicy !== undefined ? { approvalPolicy: override.approvalPolicy } : {}),
    };

    // Persist
    await this.threadService.updateRecordRuntime(projectId, threadName, {
      executionPolicyOverride: merged,
    });

    const resolved = {
      sandbox: merged.sandbox ?? project.sandbox ?? "",
      approvalPolicy: merged.approvalPolicy ?? project.approvalPolicy ?? "",
    };

    log.info({
      projectId,
      threadName,
      actorId,
      override: merged,
      resolved,
    }, "thread execution policy updated");

    // Audit
    if (this.auditService) {
      void this.auditService.append({
        projectId,
        actorId,
        action: "thread.policy.update",
        result: "ok",
        detailJson: { threadName, override: merged, resolved },
      });
    }

    // Release cached backend API session so the next turn creates a new session
    // with the updated sandbox/approvalPolicy. Critical for ACP backends where
    // policy is bound at session/new time.
    if (this.threadReleaser) {
      try {
        await this.threadReleaser.releaseThread(projectId, threadName);
        log.info({ projectId, threadName }, "released cached backend session after policy update");
      } catch (err) {
        log.warn({ projectId, threadName, err: err instanceof Error ? err.message : String(err) },
          "failed to release cached backend session after policy update (non-critical)");
      }
    }

    return {
      threadName,
      applied: merged,
      resolved,
    };
  }

  /**
   * Guard: ensure no active turn or blocking turn exists on the thread.
   */
  private async guardNoActiveTurn(
    projectId: string,
    threadName: string,
  ): Promise<void> {
    const state = await this.threadService.getRuntimeState(projectId, threadName);
    if (state?.activeTurnId || state?.blockingTurnId) {
      throw new OrchestratorError(
        ErrorCode.THREAD_POLICY_BLOCKED_ACTIVE_TURN,
        `Cannot modify thread policy while a turn is active or blocking: ${threadName}`,
        { activeTurnId: state.activeTurnId, blockingTurnId: state.blockingTurnId },
      );
    }
  }
}
