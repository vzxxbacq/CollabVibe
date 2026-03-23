import { createBackendIdentity } from "../../packages/agent-core/src/index";
import type { RuntimeConfig } from "../../packages/agent-core/src/index";
import { createLogger } from "../../packages/logger/src/index";
import { OrchestratorError, ErrorCode } from "../errors";
import type { PluginService } from "../plugin/plugin-service";
import type { ThreadRuntimeService } from "./thread-runtime-service";
import type { ThreadService } from "./thread-service";
import type { CreateThreadOptions, CreateThreadResult, ThreadListResult } from "./use-case-contracts";

const log = createLogger("thread-use-case");

export class ThreadUseCaseService {
  constructor(
    private readonly threadService: ThreadService,
    private readonly threadRuntimeService: ThreadRuntimeService,
    private readonly pluginService?: PluginService,
  ) {}

  async createThread(
    projectId: string,
    userId: string,
    threadName: string,
    options: CreateThreadOptions,
  ): Promise<CreateThreadResult> {
    const backend = createBackendIdentity(options.backendId, options.model);
    let reservation;
    try {
      reservation = this.threadService.reserve({ projectId, threadName, backend });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith("THREAD_ALREADY_EXISTS:")) {
        throw error;
      }
      const existing = this.threadService.getRecord(projectId, threadName);
      const suffix = existing ? ` (ID: ${existing.threadId.slice(0, 8)})` : "";
      throw new OrchestratorError(
        ErrorCode.THREAD_ALREADY_EXISTS,
        `Thread "${threadName}" 已存在${suffix}，请直接使用或选择其他名称`,
      );
    }

    let runtimeCreated = false;
    try {
      let mcpServers: RuntimeConfig["mcpServers"] | undefined;
      if (this.pluginService) {
        try {
          const collected = await this.pluginService.collectMcpServers(projectId);
          if (collected.length > 0) {
            mcpServers = collected.map((server) => ({
              name: server.name,
              command: server.command,
              args: server.args,
              env: server.env,
            }));
          }
        } catch (error) {
          log.warn({
            projectId,
            threadName,
            err: error instanceof Error ? error.message : String(error),
          }, "collectMcpServers failed; continuing without MCP servers");
        }
      }

      const runtime = await this.threadRuntimeService.createForNewThread({
        projectId,
        threadName,
        backend,
        backendId: options.backendId,
        profileName: options.profileName,
        overrides: {
          cwd: options.cwd,
          approvalPolicy: options.approvalPolicy,
          profileName: options.profileName,
        },
        mcpServers,
      });
      runtimeCreated = true;
      const created = await runtime.api.threadStart(runtime.config);

      this.threadService.activate(reservation.reservationId, {
        projectId,
        threadName,
        threadId: created.thread.id,
        backend,
      });
      await this.threadService.bindUserToThread(projectId, userId, threadName, created.thread.id);

      log.info({
        projectId,
        threadName,
        threadId: created.thread.id,
        backend: backend.backendId,
        model: backend.model,
      }, "thread created");
      return { threadId: created.thread.id, threadName, cwd: runtime.config.cwd ?? "", api: runtime.api };
    } catch (error) {
      this.threadService.release(reservation.reservationId);
      if (runtimeCreated) {
        try {
          await this.threadRuntimeService.releaseThread(projectId, threadName);
        } catch (releaseError) {
          log.warn({
            projectId,
            threadName,
            err: releaseError instanceof Error ? releaseError.message : String(releaseError),
          }, "releaseThread failed during createThread cleanup");
        }
      }
      throw error;
    }
  }

  async joinThread(projectId: string, userId: string, threadName: string): Promise<{ threadId: string; threadName: string }> {
    const record = this.threadService.getRecord(projectId, threadName);
    if (!record) {
      throw new OrchestratorError(ErrorCode.THREAD_NOT_FOUND, `thread not found: ${threadName}`);
    }
    await this.threadService.bindUserToThread(projectId, userId, threadName, record.threadId);
    return { threadId: record.threadId, threadName };
  }

  async leaveThread(projectId: string, userId: string): Promise<void> {
    await this.threadService.leaveUserThread(projectId, userId);
  }

  async listThreads(projectId: string): Promise<Array<{ threadName: string; threadId: string }>> {
    return this.threadService.listRecords(projectId).map((record) => ({
      threadName: record.threadName,
      threadId: record.threadId,
    }));
  }

  async listThreadEntries(projectId: string): Promise<ThreadListResult[]> {
    return this.threadService.listEntries(projectId).map((entry) => ({
      threadName: entry.threadName,
      threadId: entry.threadId,
      status: entry.status,
      backendId: entry.backend.backendId,
      model: entry.backend.model,
    }));
  }
}
