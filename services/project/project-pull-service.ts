/**
 * ProjectPullService — L2 service for project-level pull alignment.
 *
 * Implements the preview→confirm protocol:
 *   1. preview() — fetch, classify all threads, generate a preview result
 *   2. confirm() — revalidate, execute ff/rewrite, update thread registries
 *
 * Follows the explicit deps-interface DI pattern (same as MergeUseCase).
 */
import { randomUUID } from "node:crypto";
import type { ProjectResolver } from "./project-resolver";
import type { ProjectRecord } from "./project-types";
import type { ThreadRegistry } from "../thread/contracts";
import type { ThreadRecord } from "../thread/types";
import type { ThreadTurnState } from "../thread/thread-turn-state";
import type { SessionStateService } from "../session/session-state-service";
import { projectThreadKey } from "../session/session-state-service";
import type { MergeSessionRepository } from "../merge/merge-session-repository";
import type { MergeSession } from "../merge/merge-session-model";
import type { GitOps } from "../../packages/git-utils/src/index";
import { createLogger } from "../../packages/logger/src/index";

import type {
  ProjectPullMode,
  ProjectPullThreadDisposition,
  ThreadDispositionEntry,
  ProjectPullPreviewResult,
  ProjectPullConfirmResult,
} from "./project-pull-types";

const log = createLogger("project-pull");

/* ── TTL ─────────────────────────────────────────────────────────── */

const PREVIEW_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface StoredPreview {
  result: ProjectPullPreviewResult;
  createdAt: number;
}

/* ── Deps interface ──────────────────────────────────────────────── */

export interface ProjectPullServiceDeps {
  projectResolver: ProjectResolver;
  threadRegistry: ThreadRegistry;
  threadService: {
    getRuntimeState(projectId: string, threadName: string): Promise<ThreadTurnState | null>;
    updateRecordRuntime(projectId: string, threadName: string,
      patch: Partial<Pick<ThreadRecord, "baseSha" | "hasDiverged" | "worktreePath" | "executionPolicyOverride">>): Promise<void>;
  };
  sessionStateService: SessionStateService;
  mergeSessionRepository: MergeSessionRepository;
  mergeUseCase: {
    getMergeSession(projectId: string, branchName: string): MergeSession | undefined;
  };
  gitOps: GitOps;
}

/* ── Service ─────────────────────────────────────────────────────── */

export class ProjectPullService {
  /** At most one preview per project at a time. */
  private readonly previews = new Map</* projectId */ string, StoredPreview>();

  constructor(private readonly deps: ProjectPullServiceDeps) {}

  /* ────────────────────── preview ────────────────────── */

  async preview(projectId: string, targetRef: string): Promise<ProjectPullPreviewResult> {
    const project = await this.resolveProject(projectId);
    const cwd = project.cwd;

    // 1. Fetch remote
    await this.deps.gitOps.repo.fetch(cwd);

    // 2. Resolve HEAD refs
    const currentHead = await this.deps.gitOps.worktree.getHeadSha(cwd);
    const targetHead = await this.deps.gitOps.repo.resolveRef(cwd, targetRef);

    // 3. Project-level hard blockers (§6.1)
    const isDirty = await this.deps.gitOps.commit.isDirty(cwd);
    if (isDirty) {
      throw new Error("project worktree has uncommitted changes — commit or stash before pulling");
    }
    const currentBranch = await this.deps.gitOps.repo.getCurrentBranch(cwd);
    if (currentBranch !== project.workBranch) {
      throw new Error(
        `project cwd is on branch "${currentBranch}", expected "${project.workBranch}" — cannot pull`,
      );
    }

    // 4. Determine mode
    const mode = await this.determineMode(cwd, currentHead, targetHead);

    // 5. Classify all threads
    const threads = await this.deps.threadRegistry.list(projectId);
    const entries = await Promise.all(
      threads.map(t => this.classifyThread(projectId, project, t, targetHead)),
    );

    // 6. Partition
    const hardBlockers: ThreadDispositionEntry[] = [];
    const autoUpdates: ThreadDispositionEntry[] = [];
    const manualFollowUps: ThreadDispositionEntry[] = [];

    for (const entry of entries) {
      if (entry.disposition.startsWith("blocked_")) {
        hardBlockers.push(entry);
      } else if (entry.disposition.startsWith("auto_") || entry.disposition === "noop_already_aligned") {
        autoUpdates.push(entry);
      } else {
        manualFollowUps.push(entry);
      }
    }

    const previewId = randomUUID();
    const now = Date.now();

    const result: ProjectPullPreviewResult = {
      previewId,
      projectId,
      projectName: project.name,
      workBranch: project.workBranch,
      targetRef,
      currentHead,
      targetHead,
      mode,
      expiresAt: new Date(now + PREVIEW_TTL_MS).toISOString(),
      hardBlockers,
      autoUpdates,
      manualFollowUps,
      canConfirm: hardBlockers.length === 0,
    };

    // Store (replace any previous preview for this project)
    this.previews.set(projectId, { result, createdAt: now });
    this.scheduleCleanup(projectId);

    log.info({
      projectId,
      previewId,
      mode,
      hardBlockers: hardBlockers.length,
      autoUpdates: autoUpdates.length,
      manualFollowUps: manualFollowUps.length,
    }, "project-pull preview generated");

    return result;
  }

  /* ────────────────────── confirm ────────────────────── */

  async confirm(projectId: string, previewId: string): Promise<ProjectPullConfirmResult> {
    // 1. Retrieve stored preview
    const stored = this.previews.get(projectId);
    if (!stored || stored.result.previewId !== previewId) {
      throw new Error(`project pull preview not found or mismatched: ${previewId}`);
    }
    if (Date.now() > stored.createdAt + PREVIEW_TTL_MS) {
      this.previews.delete(projectId);
      throw new Error("project pull preview expired, please re-run preview");
    }

    const preview = stored.result;
    const project = await this.resolveProject(projectId);
    const cwd = project.cwd;

    // 2. Revalidate: current HEAD must still match preview snapshot
    const currentHead = await this.deps.gitOps.worktree.getHeadSha(cwd);
    if (currentHead !== preview.currentHead) {
      this.previews.delete(projectId);
      throw new Error(
        `project HEAD has drifted since preview (expected ${preview.currentHead}, got ${currentHead}). Please re-run preview.`,
      );
    }

    // 3. Revalidate: target ref must still match preview snapshot (§3.3)
    const targetHead = await this.deps.gitOps.repo.resolveRef(cwd, preview.targetRef);
    if (targetHead !== preview.targetHead) {
      this.previews.delete(projectId);
      throw new Error(
        `target ref "${preview.targetRef}" has drifted since preview (expected ${preview.targetHead}, got ${targetHead}). Please re-run preview.`,
      );
    }

    // 4. Revalidate: no new hard blockers
    const threads = await this.deps.threadRegistry.list(projectId);
    for (const t of threads) {
      const entry = await this.classifyThread(projectId, project, t, preview.targetHead);
      if (entry.disposition.startsWith("blocked_")) {
        this.previews.delete(projectId);
        throw new Error(
          `revalidation failed: thread "${t.threadName}" is now "${entry.disposition}" (${entry.reason ?? "no details"}). Please re-run preview.`,
        );
      }
    }

    // 5. Execute project-level update
    const mode = preview.mode;
    let newHead: string;

    if (mode === "fast_forward") {
      newHead = await this.deps.gitOps.worktree.fastForward(cwd, preview.targetHead);
    } else if (mode === "rewrite") {
      newHead = await this.deps.gitOps.repo.resetHard(cwd, preview.targetHead);
    } else {
      // no_op
      newHead = currentHead;
    }

    // 6. Execute per-thread updates
    const autoUpdatedThreads: ProjectPullConfirmResult["autoUpdatedThreads"] = [];
    const manualFollowUps: ThreadDispositionEntry[] = [];
    const errors: ProjectPullConfirmResult["errors"] = [];

    for (const entry of preview.autoUpdates) {
      if (entry.disposition === "noop_already_aligned") continue;

      const threadRecord = threads.find(t => t.threadName === entry.threadName);
      if (!threadRecord) {
        errors.push({ threadName: entry.threadName, error: "thread no longer exists" });
        continue;
      }

      try {
        if (entry.disposition === "auto_fast_forward") {
          await this.executeAutoFastForward(threadRecord, newHead, projectId);
          autoUpdatedThreads.push({
            threadName: entry.threadName,
            disposition: "auto_fast_forward",
            newBaseSha: newHead,
          });
        } else if (entry.disposition === "auto_recreate") {
          await this.executeAutoRecreate(project, threadRecord, newHead, projectId);
          autoUpdatedThreads.push({
            threadName: entry.threadName,
            disposition: "auto_recreate",
            newBaseSha: newHead,
          });
        }
      } catch (err) {
        errors.push({
          threadName: entry.threadName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Carry over manual follow-ups from preview
    manualFollowUps.push(...preview.manualFollowUps);

    // 7. Cleanup stored preview
    this.previews.delete(projectId);

    const result: ProjectPullConfirmResult = {
      projectId,
      mode,
      oldHead: preview.currentHead,
      newHead,
      autoUpdatedThreads,
      manualFollowUps,
      errors,
    };

    log.info({
      projectId,
      mode,
      oldHead: preview.currentHead,
      newHead,
      autoUpdated: autoUpdatedThreads.length,
      manualFollowUps: manualFollowUps.length,
      errors: errors.length,
    }, "project-pull confirm completed");

    return result;
  }

  /* ────────────────────── private: mode detection ────────────────── */

  private async determineMode(
    cwd: string, currentHead: string, targetHead: string,
  ): Promise<ProjectPullMode> {
    if (currentHead === targetHead) return "no_op";
    const isFF = await this.deps.gitOps.repo.isAncestor(cwd, currentHead, targetHead);
    return isFF ? "fast_forward" : "rewrite";
  }

  /* ────────────────────── private: thread classification ─────────── */

  private async classifyThread(
    projectId: string,
    project: ProjectRecord,
    thread: ThreadRecord,
    targetHead: string,
  ): Promise<ThreadDispositionEntry> {
    const { threadName, baseSha, hasDiverged, worktreePath } = thread;
    const cwd = project.cwd;

    // --- blockers first (order matters) ---

    // 1. Active turn / blocking turn
    const turnState = await this.deps.threadService.getRuntimeState(projectId, threadName);
    if (turnState?.activeTurnId || turnState?.blockingTurnId) {
      return { threadName, disposition: "blocked_active_turn", reason: `activeTurnId=${turnState.activeTurnId ?? "none"}, blockingTurnId=${turnState.blockingTurnId ?? "none"}` };
    }

    // Check session state machine
    const key = projectThreadKey(projectId, threadName);
    const machineState = this.deps.sessionStateService.getStateMachine(key).getState();
    if (machineState !== "IDLE" && machineState !== "INTERRUPTED" && machineState !== "FAILED") {
      return { threadName, disposition: "blocked_active_turn", reason: `session state: ${machineState}` };
    }

    // 2. Merge session (persisted)
    const activeMergeSessions = await this.deps.mergeSessionRepository.listActive([projectId]);
    const hasPersisted = activeMergeSessions.some(s => s.branchName === threadName);
    if (hasPersisted) {
      return { threadName, disposition: "blocked_merge_session", reason: "persisted merge session active" };
    }

    // 3. In-memory merge session
    const inMemorySession = this.deps.mergeUseCase.getMergeSession(projectId, threadName);
    if (inMemorySession) {
      return { threadName, disposition: "blocked_merge_session", reason: "in-memory merge session active" };
    }

    // 4. MERGE_HEAD check (if worktree exists)
    if (worktreePath) {
      try {
        await this.deps.gitOps.accessCheck(worktreePath);
        const mergeHeadPresent = await this.deps.gitOps.merge.hasMergeHead(worktreePath);
        if (mergeHeadPresent) {
          return { threadName, disposition: "blocked_merge_head_present", reason: "MERGE_HEAD exists in worktree" };
        }
      } catch {
        // worktree inaccessible — handled below as missing worktree
      }
    }

    // --- worktree missing ---
    if (!worktreePath) {
      // §5.9: missing worktree classification
      if (hasDiverged) {
        return { threadName, disposition: "blocked_unknown_state", reason: "diverged thread with no worktreePath recorded" };
      }
      return { threadName, disposition: "auto_recreate", reason: "worktree missing, non-diverged: safe to recreate" };
    }

    // Check worktree physically exists
    let worktreeExists = true;
    try {
      await this.deps.gitOps.accessCheck(worktreePath);
    } catch {
      worktreeExists = false;
    }

    if (!worktreeExists) {
      // §5.9: worktree lost
      if (hasDiverged) {
        return { threadName, disposition: "blocked_unknown_state", reason: "diverged thread with lost worktree" };
      }
      return { threadName, disposition: "auto_recreate", reason: "worktree lost, non-diverged: safe to recreate" };
    }

    // --- noop ---
    if (baseSha === targetHead) {
      return { threadName, disposition: "noop_already_aligned" };
    }

    // --- diverged ---
    if (hasDiverged) {
      return { threadName, disposition: "manual_stale_diverged", reason: "thread has diverged (agent commits exist)" };
    }

    // --- dirty worktree ---
    const isDirty = await this.deps.gitOps.commit.isDirty(worktreePath);
    if (isDirty) {
      return { threadName, disposition: "manual_dirty_worktree", reason: "worktree has uncommitted changes" };
    }

    // --- auto_fast_forward vs auto_recreate ---
    if (baseSha) {
      const canFF = await this.deps.gitOps.repo.isAncestor(cwd, baseSha, targetHead);
      if (canFF) {
        return { threadName, disposition: "auto_fast_forward" };
      }
    }

    // baseSha is not ancestor of targetHead (or no baseSha)
    return { threadName, disposition: "auto_recreate", reason: "baseSha not ancestor of targetHead" };
  }

  /* ────────────────────── private: execution helpers ─────────────── */

  private async executeAutoFastForward(thread: ThreadRecord, newHead: string, projectId: string): Promise<void> {
    if (!thread.worktreePath) {
      throw new Error(`auto_fast_forward requires worktree for thread "${thread.threadName}"`);
    }
    await this.deps.gitOps.worktree.fastForward(thread.worktreePath, newHead);
    await this.deps.threadService.updateRecordRuntime(projectId, thread.threadName, {
      baseSha: newHead,
      hasDiverged: false,
    });
  }

  private async executeAutoRecreate(
    project: ProjectRecord, thread: ThreadRecord, newHead: string, projectId: string,
  ): Promise<void> {
    const { threadName } = thread;

    // Remove old worktree if it still exists
    if (thread.worktreePath) {
      try {
        await this.deps.gitOps.accessCheck(thread.worktreePath);
        await this.deps.gitOps.worktree.remove(project.cwd, thread.worktreePath, threadName);
      } catch {
        // already gone — fine
      }
    }

    // Create new worktree at the new HEAD
    const newWorktreePath = this.deps.gitOps.worktree.getPath(project.cwd, threadName);
    await this.deps.gitOps.worktree.create(project.cwd, threadName, newWorktreePath);

    // Update registry
    await this.deps.threadService.updateRecordRuntime(projectId, threadName, {
      baseSha: newHead,
      hasDiverged: false,
      worktreePath: newWorktreePath,
    });
  }

  /* ────────────────────── private: helpers ───────────────────────── */

  private async resolveProject(projectId: string): Promise<ProjectRecord> {
    if (!this.deps.projectResolver.findProjectById) {
      throw new Error("ProjectResolver.findProjectById is not available");
    }
    const project = await this.deps.projectResolver.findProjectById(projectId);
    if (!project) {
      throw new Error(`project not found: ${projectId}`);
    }
    if (project.status !== "active") {
      throw new Error(`project "${project.name}" is ${project.status}, cannot pull`);
    }
    return project;
  }

  private scheduleCleanup(projectId: string): void {
    setTimeout(() => {
      const stored = this.previews.get(projectId);
      if (stored && Date.now() > stored.createdAt + PREVIEW_TTL_MS) {
        this.previews.delete(projectId);
        log.debug({ projectId }, "expired preview cleaned up");
      }
    }, PREVIEW_TTL_MS + 1000);
  }
}
