import { createSnapshot, restoreSnapshot, pinSnapshot } from "../../../../packages/git-utils/src/snapshot";
import type { AgentApi } from "../../../../packages/agent-core/src/types";
import type { IMOutputMessage, IMProgressEvent } from "../../../contracts/im/im-output";
import type { TurnStateSnapshot } from "../../../contracts/im/turn-state";
import type { TurnDiffResult } from "../../../../packages/git-utils/src/commit";
import { createLogger } from "../../../../packages/logger/src/index";
import type { SnapshotRepository } from "../snapshot/snapshot-types";
import type { TurnDetailRecord, TurnToolCall } from "./turn-detail-record";
import { TurnServiceBase, type TurnServiceBaseDeps } from "./turn-service-base";
import type { RecordTurnStartInput, TurnMetadataPatch, TurnSummaryPatch } from "./turn-types";

export interface TurnCommandServiceDeps extends TurnServiceBaseDeps {
  snapshotRepo?: SnapshotRepository;
  resolveAgentApi: (chatId: string, threadName: string) => Promise<AgentApi>;
  resolveThreadName: (chatId: string, userId?: string) => Promise<string | null>;
  createSnapshot?: typeof createSnapshot;
  restoreSnapshot?: typeof restoreSnapshot;
  pinSnapshot?: typeof pinSnapshot;
}

export class TurnCommandService extends TurnServiceBase {
  private readonly log = createLogger("turn-command-service");

  constructor(private readonly commandDeps: TurnCommandServiceDeps) {
    super(commandDeps);
  }

  async recordTurnStart(input: RecordTurnStartInput): Promise<{ turnNumber: number }> {
    const snapshotSha = await (this.commandDeps.createSnapshot ?? createSnapshot)(input.cwd);
    const createdAt = this.deps.nowIso();
    const threadRecord = this.deps.threadService.getRecord(input.projectId, input.threadName);
    const maxTurnNumber = await this.deps.turnRepository.getMaxTurnNumber(input.projectId, input.threadName);
    const turnNumber = maxTurnNumber + 1;
    await this.deps.turnRepository.create({
      chatId: input.chatId,
      projectId: input.projectId,
      threadName: input.threadName,
      threadId: input.threadId,
      turnId: input.turnId,
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
        await (this.commandDeps.pinSnapshot ?? pinSnapshot)(input.cwd, snapshotSha, `codex-turn-${input.turnId}`);
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

  async updateTurnSummary(chatId: string, turnId: string, summary: TurnSummaryPatch): Promise<void> {
    const turn = await this.deps.turnRepository.getByTurnId(this.requireProjectId(chatId), turnId);
    if (!turn) return;
    await this.deps.turnRepository.update({
      ...turn,
      lastAgentMessage: summary.lastAgentMessage ?? turn.lastAgentMessage,
      tokenUsage: summary.tokenUsage ?? turn.tokenUsage,
      filesChanged: summary.filesChanged ?? turn.filesChanged,
      updatedAt: this.deps.nowIso(),
    });
  }

  async updateTurnMetadata(chatId: string, turnId: string, patch: TurnMetadataPatch): Promise<void> {
    const projectId = this.requireProjectId(chatId);
    const detail = await this.deps.turnDetailRepository.getByTurnId(projectId, turnId);
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

  async appendTurnEvent(chatId: string, message: IMOutputMessage): Promise<void> {
    if (!("turnId" in message) || !message.turnId) return;
    const projectId = this.requireProjectId(chatId);
    const detail = await this.deps.turnDetailRepository.getByTurnId(projectId, message.turnId);
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

  async syncTurnState(chatId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void> {
    const projectId = this.requireProjectId(chatId);
    const detail = await this.deps.turnDetailRepository.getByTurnId(projectId, turnId);
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

  async finalizeTurnState(chatId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void> {
    await this.syncTurnState(chatId, turnId, snapshot);
    const projectId = this.requireProjectId(chatId);
    const turn = await this.deps.turnRepository.getByTurnId(projectId, turnId);
    if (!turn) return;
    await this.deps.turnRepository.update({
      ...turn,
      lastAgentMessage: snapshot.content || turn.lastAgentMessage,
      tokenUsage: snapshot.tokenUsage ?? turn.tokenUsage,
      updatedAt: this.deps.nowIso(),
    });
  }

  async interruptTurn(chatId: string, userId?: string): Promise<{ interrupted: boolean }> {
    const projectId = this.requireProjectId(chatId);
    const threadName = await this.commandDeps.resolveThreadName(chatId, userId);
    if (!threadName) return { interrupted: false };
    const state = await this.getThreadTurnState(chatId, threadName);
    if (!state?.activeTurnId) return { interrupted: false };
    const active = await this.deps.turnRepository.getByTurnId(projectId, state.activeTurnId);
    if (!active?.snapshotSha) return { interrupted: false };

    const api = await this.commandDeps.resolveAgentApi(chatId, threadName);
    if (api.turnInterrupt) {
      await api.turnInterrupt(active.threadId, active.turnId);
    }
    await (this.commandDeps.restoreSnapshot ?? restoreSnapshot)(active.cwd, active.snapshotSha);
    await this.deps.turnRepository.update({ ...active, status: "interrupted", updatedAt: this.deps.nowIso() });
    await this.deps.threadService.markTurnInterrupted(projectId, threadName);
    return { interrupted: true };
  }

  async acceptTurn(chatId: string, turnId: string): Promise<{ accepted: boolean }> {
    const turn = await this.deps.turnRepository.getByTurnId(this.requireProjectId(chatId), turnId);
    if (!turn || turn.status !== "awaiting_approval") return { accepted: false };
    const resolvedAt = this.deps.nowIso();
    await this.deps.turnRepository.update({ ...turn, status: "accepted", approvalResolvedAt: resolvedAt, updatedAt: resolvedAt });
    const state = await this.getThreadTurnState(chatId, turn.threadName);
    if (state?.blockingTurnId === turnId) {
      await this.deps.threadService.clearBlockingTurn(this.requireProjectId(chatId), turn.threadName);
    }
    return { accepted: true };
  }

  async revertTurn(chatId: string, turnId: string): Promise<{ rolledBack: boolean }> {
    const turn = await this.deps.turnRepository.getByTurnId(this.requireProjectId(chatId), turnId);
    if (!turn?.snapshotSha) return { rolledBack: false };
    const api = await this.commandDeps.resolveAgentApi(chatId, turn.threadName);
    if (api.threadRollback) {
      await api.threadRollback(turn.threadId, 1);
    }
    await (this.commandDeps.restoreSnapshot ?? restoreSnapshot)(turn.cwd, turn.snapshotSha);
    const resolvedAt = this.deps.nowIso();
    await this.deps.turnRepository.update({ ...turn, status: "reverted", approvalResolvedAt: resolvedAt, updatedAt: resolvedAt });
    await this.deps.threadService.clearTurnReferences(this.requireProjectId(chatId), turn.threadName, turnId);
    return { rolledBack: true };
  }

  async completeActiveTurn(chatId: string, threadName: string, diff: TurnDiffResult | null): Promise<void> {
    const projectId = this.requireProjectId(chatId);
    const turnId = await this.deps.threadService.getActiveTurnId(projectId, threadName);
    if (!turnId) {
      return;
    }
    const turn = await this.deps.turnRepository.getByTurnId(projectId, turnId);
    if (!turn) {
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
      await this.deps.threadService.markTurnAwaitingApproval(projectId, threadName, turnId);
      return;
    }
    await this.deps.turnRepository.update({
      ...turn,
      status: "completed",
      approvalRequired: false,
      completedAt,
      updatedAt: completedAt,
    });
    await this.deps.threadService.markTurnCompleted(projectId, threadName, turnId);
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
