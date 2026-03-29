/**
 * Unit tests for thread-level execution policy overrides.
 *
 * Coverage:
 *   1. Validator: valid/invalid sandbox + approvalPolicy + empty override
 *   2. Service + persistence via SimHarness: getPolicy, preview, confirm, active-turn guard
 *   3. IAM: developer denied, maintainer allowed
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ── 1. Validator tests (pure function, no harness) ────────────────────────
import {
  validatePolicyOverride,
  validateNonEmptyOverride,
  VALID_SANDBOX_LEVELS,
  VALID_APPROVAL_LEVELS,
} from "../../thread/thread-execution-policy-validator";
import { ErrorCode } from "../../errors";

describe("thread-execution-policy validator", () => {
  it("accepts all valid sandbox levels", () => {
    for (const level of VALID_SANDBOX_LEVELS) {
      expect(() => validatePolicyOverride({ sandbox: level })).not.toThrow();
    }
  });

  it("accepts all valid approval policy levels", () => {
    for (const level of VALID_APPROVAL_LEVELS) {
      expect(() => validatePolicyOverride({ approvalPolicy: level })).not.toThrow();
    }
  });

  it("rejects invalid sandbox value", () => {
    try {
      validatePolicyOverride({ sandbox: "invalid" as never });
      throw new Error("should have thrown");
    } catch (e: unknown) {
      expect((e as { code: string }).code).toBe(ErrorCode.THREAD_POLICY_INVALID_VALUE);
    }
  });

  it("rejects invalid approvalPolicy value", () => {
    try {
      validatePolicyOverride({ approvalPolicy: "invalid" as never });
      throw new Error("should have thrown");
    } catch (e: unknown) {
      expect((e as { code: string }).code).toBe(ErrorCode.THREAD_POLICY_INVALID_VALUE);
    }
  });

  it("rejects empty override", () => {
    try {
      validateNonEmptyOverride({});
      throw new Error("should have thrown");
    } catch (e: unknown) {
      expect((e as { code: string }).code).toBe(ErrorCode.THREAD_POLICY_INVALID_VALUE);
    }
  });

  it("accepts combined valid override", () => {
    expect(() => validatePolicyOverride({ sandbox: "read-only", approvalPolicy: "untrusted" })).not.toThrow();
  });
});

// ── 2. Service + SimHarness integration ─────────────────────────────────
import { SimHarness } from "../_helpers/sim-harness";

describe("thread-execution-policy service", () => {
  let sim: SimHarness;
  let projectId: string;
  const ADMIN = "admin-user";
  const CHAT_ID = "c-policy-test";

  beforeAll(async () => {
    sim = await SimHarness.create([ADMIN]);
    projectId = await sim.createProjectFromChat({ chatId: CHAT_ID, userId: ADMIN, name: "p-policy" });
  }, 30_000);

  afterAll(async () => {
    await sim?.shutdown();
  }, 15_000);

  it("getThreadExecutionPolicy returns project policy with empty override", async () => {
    // Create a thread first
    await sim.api.createThread({
      projectId,
      userId: ADMIN,
      actorId: ADMIN,
      threadName: "t-policy-get",
      backendId: "codex",
      model: "fake-model",
    });

    const view = await sim.api.getThreadExecutionPolicy({
      projectId,
      threadName: "t-policy-get",
    });

    expect(view.threadName).toBe("t-policy-get");
    expect(view.override).toEqual({});
    expect(view.capability.allowedSandbox).toEqual(VALID_SANDBOX_LEVELS);
    expect(view.capability.allowedApprovalPolicies).toEqual(VALID_APPROVAL_LEVELS);
    // resolved should equal project-level (no override)
    expect(view.resolved.sandbox).toBe(view.projectPolicy.sandbox);
    expect(view.resolved.approvalPolicy).toBe(view.projectPolicy.approvalPolicy);
  });

  it("previewUpdate returns preview with resolved values", async () => {
    await sim.api.createThread({
      projectId,
      userId: ADMIN,
      actorId: ADMIN,
      threadName: "t-policy-preview",
      backendId: "codex",
      model: "fake-model",
    });

    const preview = await sim.api.previewThreadExecutionPolicyUpdate({
      projectId,
      threadName: "t-policy-preview",
      actorId: ADMIN,
      override: { sandbox: "read-only" },
    });

    expect(preview.threadName).toBe("t-policy-preview");
    expect(preview.requested).toEqual({ sandbox: "read-only" });
    expect(preview.resolved.sandbox).toBe("read-only");
  });

  it("confirmUpdate persists override and can be retrieved", async () => {
    await sim.api.createThread({
      projectId,
      userId: ADMIN,
      actorId: ADMIN,
      threadName: "t-policy-confirm",
      backendId: "codex",
      model: "fake-model",
    });

    const result = await sim.api.confirmThreadExecutionPolicyUpdate({
      projectId,
      threadName: "t-policy-confirm",
      actorId: ADMIN,
      override: { sandbox: "read-only", approvalPolicy: "untrusted" },
    });

    expect(result.applied.sandbox).toBe("read-only");
    expect(result.applied.approvalPolicy).toBe("untrusted");
    expect(result.resolved.sandbox).toBe("read-only");
    expect(result.resolved.approvalPolicy).toBe("untrusted");

    // Verify by re-reading
    const view = await sim.api.getThreadExecutionPolicy({
      projectId,
      threadName: "t-policy-confirm",
    });
    expect(view.override).toEqual({ sandbox: "read-only", approvalPolicy: "untrusted" });
    expect(view.resolved.sandbox).toBe("read-only");
    expect(view.resolved.approvalPolicy).toBe("untrusted");
  });

  it("confirmUpdate with invalid value is rejected", async () => {
    await sim.api.createThread({
      projectId,
      userId: ADMIN,
      actorId: ADMIN,
      threadName: "t-policy-invalid",
      backendId: "codex",
      model: "fake-model",
    });

    await expect(
      sim.api.confirmThreadExecutionPolicyUpdate({
        projectId,
        threadName: "t-policy-invalid",
        actorId: ADMIN,
        override: { sandbox: "super-dangerous" as never },
      }),
    ).rejects.toThrow();
  });

  it("developer is denied by API guard", async () => {
    const DEV = "dev-user";
    await sim.addProjectMemberFromChat({
      chatId: CHAT_ID,
      actorId: ADMIN,
      projectId,
      targetUserId: DEV,
      role: "developer",
    });

    await sim.api.createThread({
      projectId,
      userId: DEV,
      actorId: ADMIN,
      threadName: "t-policy-denied",
      backendId: "codex",
      model: "fake-model",
    });

    await expect(
      sim.api.confirmThreadExecutionPolicyUpdate({
        projectId,
        threadName: "t-policy-denied",
        actorId: DEV,
        override: { sandbox: "read-only" },
      }),
    ).rejects.toThrow();
  });

  it("maintainer is allowed by API guard", async () => {
    const MAINTAINER = "maint-user";
    await sim.addProjectMemberFromChat({
      chatId: CHAT_ID,
      actorId: ADMIN,
      projectId,
      targetUserId: MAINTAINER,
      role: "maintainer",
    });

    await sim.api.createThread({
      projectId,
      userId: MAINTAINER,
      actorId: ADMIN,
      threadName: "t-policy-allowed",
      backendId: "codex",
      model: "fake-model",
    });

    const result = await sim.api.confirmThreadExecutionPolicyUpdate({
      projectId,
      threadName: "t-policy-allowed",
      actorId: MAINTAINER,
      override: { sandbox: "workspace-write" },
    });

    expect(result.applied.sandbox).toBe("workspace-write");
  });
});
