import type { AgentApi } from "../../packages/agent-core/src/index";
import type { IMOutputMessage, IMProgressEvent } from "../event/im-output";
import type { TurnStateSnapshot } from "../turn/turn-state";
import type { TurnDiffResult } from "../../packages/git-utils/src/index";
import type { GitOps } from "../../packages/git-utils/src/index";
import { createLogger } from "../../packages/logger/src/index";
import type { SnapshotRepository } from "../snapshot/contracts";
import type { TurnDetailRecord, TurnToolCall } from "./types";
import { TurnServiceBase, type TurnServiceBaseDeps } from "./turn-service-base";
import type { EnsureTurnStartInput, RecordTurnStartInput, TurnMetadataPatch, TurnSummaryPatch } from "./contracts";

export interface TurnCommandServiceDeps extends TurnServiceBaseDeps {
  snapshotRepo?: SnapshotRepository;
  resolveAgentApi: (projectId: string, threadName: string) => Promise<AgentApi>;
  resolveThreadName: (projectId: string, userId?: string) => Promise<string | null>;
  gitOps: GitOps;
}

export class TurnCommandService extends TurnServiceBase {
  private readonly log = createLogger("turn-command-service");
  private readonly startEnsureInflight = new Map<string, Promise<{ turnNumber: number }>>();

  constructor(private readonly commandDeps: TurnCommandServiceDeps) {
    super(commandDeps);
  }

  async recordTurnStart(input: RecordTurnStartInput): Promise<{ turnNumber: number }> {
    return this.createTurnStart(input);
  }

  async ensureTurnStarted(input: EnsureTurnStartInput): Promise<{ turnNumber: number }> {
    const resolvedProjectId = this.requireProjectId(input.projectId);
    const key = `${resolvedProjectId}:${input.turnId}`;
    const pending = this.startEnsureInflight.get(key);
    if (pending) {
      return pending;
    }

    const task = this.ensureTurnStartedInternal({ ...input, projectId: resolvedProjectId });
    this.startEnsureInflight.set(key, task);
    try {
      return await task;
    } finally {
      this.startEnsureInflight.delete(key);
    }
  }

  private async ensureTurnStartedInternal(input: EnsureTurnStartInput): Promise<{ turnNumber: number }> {
    const resolvedProjectId = this.requireProjectId(input.projectId);
    const existing = await this.deps.turnRepository.getByTurnId(resolvedProjectId, input.turnId);
    if (!existing) {
      const created = await this.createTurnStart(input);
        await this.updateTurnMetadata(resolvedProjectId, input.turnId, {
        promptSummary: input.promptSummary,
        backendName: input.backendName,
        modelName: input.modelName,
        turnMode: input.turnMode,
      });
      return created;
    }

    const detail = await this.deps.turnDetailRepository.getByTurnId(resolvedProjectId, input.turnId);
    if (!detail) {
      const createdAt = this.deps.nowIso();
      await this.deps.turnDetailRepository.create({
        projectId: resolvedProjectId,
        turnId: input.turnId,
        promptSummary: input.promptSummary,
        backendName: input.backendName,
        modelName: input.modelName,
        turnMode: input.turnMode,
        tools: [],
        toolOutputs: [],
        createdAt,
        updatedAt: createdAt,
      });
    } else {
      await this.updateTurnMetadata(resolvedProjectId, input.turnId, {
        promptSummary: input.promptSummary,
        backendName: input.backendName,
        modelName: input.modelName,
        turnMode: input.turnMode,
      });
    }

    if (existing.status === "running") {
      await this.deps.threadService.markTurnRunning(resolvedProjectId, input.threadName, input.turnId);
    }

    return { turnNumber: existing.turnNumber ?? 0 };
  }

  private async createTurnStart(input: RecordTurnStartInput): Promise<{ turnNumber: number }> {
    const snapshotSha = await this.commandDeps.gitOps.snapshot.create(input.cwd);
    const createdAt = this.deps.nowIso();
    const threadRecord = this.deps.threadService.getRecord(input.projectId, input.threadName);
    const maxTurnNumber = await this.deps.turnRepository.getMaxTurnNumber(input.projectId, input.threadName);
    const turnNumber = maxTurnNumber + 1;
    await this.deps.turnRepository.create({
      projectId: input.projectId,
      threadName: input.threadName,
      threadId: input.threadId,
      turnId: input.turnId,
      callId: input.callId,
      platform: input.platform,
      sourceMessageId: input.sourceMessageId,
      userId: input.userId,
      traceId: input.traceId,
      status: "running",
      cwd: input.cwd,
      snapshotSha,
      approvalRequired: false,
      turnNumber,
      createdAt,
      updatedAt: createdAt,
    });
    await this.deps.turnDetailRepository.create({
      projectId: input.projectId,
      turnId: input.turnId,
      backendName: threadRecord?.backend.backendId,
      modelName: threadRecord?.backend.model,
      tools: [],
      toolOutputs: [],
      createdAt,
      updatedAt: createdAt,
    });
    await this.deps.threadService.markTurnRunning(input.projectId, input.threadName, input.turnId);

    if (this.commandDeps.snapshotRepo) {
      try {
        await this.commandDeps.gitOps.snapshot.pin(input.cwd, snapshotSha, `codex-turn-${input.turnId}`);
        const turnIndex = (await this.commandDeps.snapshotRepo.getLatestIndex(input.projectId, input.threadId)) + 1;
        await this.commandDeps.snapshotRepo.save({
          projectId: input.projectId,
          threadId: input.threadId,
          turnId: input.turnId,
          turnIndex,
          userId: input.userId,
          cwd: input.cwd,
          gitRef: snapshotSha,
          createdAt,
        });
      } catch (error) {
        this.log.warn({
          projectId: input.projectId,
          threadId: input.threadId,
          turnId: input.turnId,
          cwd: input.cwd,
          err: error instanceof Error ? error.message : String(error)
        }, "snapshot persistence failed during recordTurnStart");
      }
    }
    return { turnNumber };
  }

  async updateTurnSummary(projectId: string, turnId: string, summary: TurnSummaryPatch): Promise<void> {
    const turn = await this.deps.turnRepository.getByTurnId(this.requireProjectId(projectId), turnId);
    if (!turn) return;
    await this.deps.turnRepository.update({
      ...turn,
      lastAgentMessage: summary.lastAgentMessage ?? turn.lastAgentMessage,
      tokenUsage: summary.tokenUsage ?? turn.tokenUsage,
      filesChanged: summary.filesChanged ?? turn.filesChanged,
      updatedAt: this.deps.nowIso(),
    });
  }

  async updateTurnMetadata(projectId: string, turnId: string, patch: TurnMetadataPatch): Promise<void> {
    const resolvedProjectId = this.requireProjectId(projectId);
    const detail = await this.deps.turnDetailRepository.getByTurnId(resolvedProjectId, turnId);
    if (!detail) return;
    await this.deps.turnDetailRepository.update({
      ...detail,
      promptSummary: patch.promptSummary ?? detail.promptSummary,
      backendName: patch.backendName ?? detail.backendName,
      modelName: patch.modelName ?? detail.modelName,
      turnMode: patch.turnMode ?? detail.turnMode,
      updatedAt: this.deps.nowIso(),
    });
  }

  async appendTurnEvent(projectId: string, message: IMOutputMessage): Promise<void> {
    if (!("turnId" in message) || !message.turnId) return;
    const resolvedProjectId = this.requireProjectId(projectId);
    const detail = await this.deps.turnDetailRepository.getByTurnId(resolvedProjectId, message.turnId);
    if (!detail) return;

    let next: TurnDetailRecord = detail;
    switch (message.kind) {
      case "content":
        next = { ...detail, message: (detail.message ?? "") + message.delta, updatedAt: this.deps.nowIso() };
        break;
      case "reasoning":
        next = { ...detail, reasoning: (detail.reasoning ?? "") + message.delta, updatedAt: this.deps.nowIso() };
        break;
      case "plan_update":
        next = {
          ...detail,
          planState: {
            explanation: message.explanation,
            items: message.plan.filter((item) => item.step.trim().length > 0)
          },
          updatedAt: this.deps.nowIso()
        };
        break;
      case "tool_output":
        next = {
          ...detail,
          toolOutputs: this.applyToolOutput(detail, message.callId, message.delta),
          updatedAt: this.deps.nowIso()
        };
        break;
      case "progress":
        next = this.applyProgressToDetail(detail, message);
        break;
      case "notification":
        if (message.category === "agent_message" || message.category === "turn_complete") {
          next = { ...detail, message: message.lastAgentMessage ?? detail.message, updatedAt: this.deps.nowIso() };
        } else return;
        break;
      case "turn_summary":
        next = { ...detail, message: message.lastAgentMessage ?? detail.message, updatedAt: this.deps.nowIso() };
        break;
      default:
        return;
    }
    await this.deps.turnDetailRepository.update(next);
  }

  async syncTurnState(projectId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void> {
    const resolvedProjectId = this.requireProjectId(projectId);
    const detail = await this.deps.turnDetailRepository.getByTurnId(resolvedProjectId, turnId);
    if (!detail) return;
    await this.deps.turnDetailRepository.update({
      ...detail,
      promptSummary: snapshot.promptSummary ?? detail.promptSummary,
      backendName: snapshot.backendName ?? detail.backendName,
      modelName: snapshot.modelName ?? detail.modelName,
      turnMode: snapshot.turnMode ?? detail.turnMode,
      message: snapshot.content || detail.message,
      reasoning: snapshot.reasoning || detail.reasoning,
      planState: snapshot.plan
        ? {
            explanation: snapshot.planExplanation,
            items: snapshot.plan,
          }
        : detail.planState,
      tools: snapshot.tools.map((tool) => ({
        label: tool.label,
        tool: tool.tool,
        callId: tool.callId,
        status: tool.status,
        targetFile: tool.targetFile,
        exitCode: tool.exitCode,
        duration: tool.duration,
        summary: tool.summary,
      })),
      toolOutputs: snapshot.toolOutputs.map((output) => ({
        callId: output.callId,
        command: output.command,
        output: output.output,
      })),
      updatedAt: this.deps.nowIso(),
    });
  }

  async finalizeTurnState(projectId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void> {
    await this.syncTurnState(projectId, turnId, snapshot);
    const resolvedProjectId = this.requireProjectId(projectId);
    const turn = await this.deps.turnRepository.getByTurnId(resolvedProjectId, turnId);
    if (!turn) return;
    await this.deps.turnRepository.update({
      ...turn,
      lastAgentMessage: snapshot.content || turn.lastAgentMessage,
      tokenUsage: snapshot.tokenUsage ?? turn.tokenUsage,
      updatedAt: this.deps.nowIso(),
    });
  }

  async interruptTurn(projectId: string, userId?: string): Promise<{ interrupted: boolean }> {
    const resolvedProjectId = this.requireProjectId(projectId);
    const threadName = await this.commandDeps.resolveThreadName(projectId, userId);
    if (!threadName) return { interrupted: false };
    const state = await this.getThreadTurnState(projectId, threadName);
    if (!state?.activeTurnId) return { interrupted: false };
    const active = await this.deps.turnRepository.getByTurnId(resolvedProjectId, state.activeTurnId);
    if (!active?.snapshotSha) return { interrupted: false };

    const api = await this.commandDeps.resolveAgentApi(projectId, threadName);
    if (api.turnInterrupt) {
      await api.turnInterrupt(active.threadId, active.turnId);
    }
    await this.commandDeps.gitOps.snapshot.restore(active.cwd, active.snapshotSha);
    await this.deps.turnRepository.update({ ...active, status: "interrupted", updatedAt: this.deps.nowIso() });
    await this.deps.threadService.markTurnInterrupted(resolvedProjectId, threadName);
    return { interrupted: true };
  }

  async acceptTurn(projectId: string, turnId: string): Promise<{ accepted: boolean }> {
    const resolvedProjectId = this.requireProjectId(projectId);
    const turn = await this.deps.turnRepository.getByTurnId(resolvedProjectId, turnId);
    if (!turn || turn.status !== "awaiting_approval") return { accepted: false };
    const resolvedAt = this.deps.nowIso();
    await this.deps.turnRepository.update({ ...turn, status: "accepted", approvalResolvedAt: resolvedAt, updatedAt: resolvedAt });
    const state = await this.getThreadTurnState(projectId, turn.threadName);
    if (state?.blockingTurnId === turnId) {
      await this.deps.threadService.clearBlockingTurn(resolvedProjectId, turn.threadName);
    }
    return { accepted: true };
  }

  async revertTurn(projectId: string, turnId: string): Promise<{ rolledBack: boolean }> {
    const resolvedProjectId = this.requireProjectId(projectId);
    const turn = await this.deps.turnRepository.getByTurnId(resolvedProjectId, turnId);
    if (!turn?.snapshotSha) return { rolledBack: false };
    const api = await this.commandDeps.resolveAgentApi(projectId, turn.threadName);
    if (api.threadRollback) {
      await api.threadRollback(turn.threadId, 1);
    }
    await this.commandDeps.gitOps.snapshot.restore(turn.cwd, turn.snapshotSha);
    const resolvedAt = this.deps.nowIso();
    await this.deps.turnRepository.update({ ...turn, status: "reverted", approvalResolvedAt: resolvedAt, updatedAt: resolvedAt });
    await this.deps.threadService.clearTurnReferences(resolvedProjectId, turn.threadName, turnId);
    return { rolledBack: true };
  }

  async completeActiveTurn(projectId: string, threadName: string, diff: TurnDiffResult | null): Promise<void> {
    const resolvedProjectId = this.requireProjectId(projectId);
    const turnId = await this.deps.threadService.getActiveTurnId(resolvedProjectId, threadName);
    if (!turnId) {
      return;
    }
    const turn = await this.deps.turnRepository.getByTurnId(resolvedProjectId, turnId);
    if (!turn) {
      return;
    }
    if (turn.status === "interrupted") {
      await this.deps.threadService.markTurnInterrupted(resolvedProjectId, threadName);
      return;
    }
    const completedAt = this.deps.nowIso();
    if (diff) {
      await this.deps.turnRepository.update({
        ...turn,
        status: "awaiting_approval",
        filesChanged: diff.filesChanged,
        diffSummary: diff.diffSummary,
        stats: diff.stats,
        approvalRequired: true,
        completedAt,
        updatedAt: completedAt,
      });
      await this.deps.threadService.markTurnAwaitingApproval(resolvedProjectId, threadName, turnId);
      return;
    }
    await this.deps.turnRepository.update({
      ...turn,
      status: "completed",
      approvalRequired: false,
      completedAt,
      updatedAt: completedAt,
    });
    await this.deps.threadService.markTurnCompleted(resolvedProjectId, threadName, turnId);
  }

  private applyToolOutput(detail: TurnDetailRecord, callId: string, delta: string): TurnDetailRecord["toolOutputs"] {
    const outputs = detail.toolOutputs.map((item) => ({ ...item }));
    const existing = outputs.find((item) => item.callId === callId);
    if (existing) {
      existing.output += delta;
      return outputs;
    }
    const relatedTool = [...detail.tools].reverse().find((tool) => tool.callId === callId);
    outputs.push({ callId, command: relatedTool?.label ?? callId, output: delta });
    return outputs;
  }

  private applyProgressToDetail(detail: TurnDetailRecord, event: IMProgressEvent): TurnDetailRecord {
    const tools = detail.tools.map((item) => ({ ...item }));
    if (event.phase === "begin") {
      tools.push({ label: event.label, tool: event.tool, callId: event.callId, status: "running", targetFile: event.targetFile });
    } else {
      const existing = this.findToolCall(tools, event);
      if (existing) {
        existing.status = event.status === "failed" ? "failed" : "completed";
        existing.exitCode = event.exitCode;
        existing.duration = event.duration;
        existing.summary = event.summary;
        existing.targetFile = event.targetFile ?? existing.targetFile;
      } else {
        tools.push({
          label: event.label,
          tool: event.tool,
          callId: event.callId,
          status: event.status === "failed" ? "failed" : "completed",
          targetFile: event.targetFile,
          exitCode: event.exitCode,
          duration: event.duration,
          summary: event.summary,
        });
      }
    }

    let toolOutputs = detail.toolOutputs;
    if (event.summary && event.callId) {
      const outputs = detail.toolOutputs.map((item) => ({ ...item }));
      const existingOutput = outputs.find((item) => item.callId === event.callId);
      if (existingOutput) existingOutput.output = event.summary;
      else outputs.push({ callId: event.callId, command: event.label, output: event.summary });
      toolOutputs = outputs;
    }

    return {
      ...detail,
      tools,
      toolOutputs,
      agentNote: event.tool === "collab_agent" && event.agentId ? `agent-${event.agentId}` : detail.agentNote,
      updatedAt: this.deps.nowIso()
    };
  }

  private findToolCall(tools: TurnToolCall[], event: IMProgressEvent): TurnToolCall | undefined {
    if (event.callId) {
      const byCallId = tools.find((item) => item.callId === event.callId);
      if (byCallId) return byCallId;
    }
    for (let i = tools.length - 1; i >= 0; i -= 1) {
      const item = tools[i]!;
      if (item.label === event.label && item.tool === event.tool && item.status === "running") return item;
    }
    return undefined;
  }
}
