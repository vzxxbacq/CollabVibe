import type { ParsedIntent } from "../../../packages/channel-core/src/types";
import type { CodexApi, RuntimeConfig, RuntimeConfigProvider } from "./types";
import { ThreadBindingService } from "./thread-binding-service";

export class ConversationOrchestrator {
  private readonly codexApi: CodexApi;

  private readonly runtimeConfigProvider: RuntimeConfigProvider;

  private readonly threadBindingService: ThreadBindingService;

  private readonly ensureThreadLocks = new Map<string, Promise<{ threadId: string; created: boolean }>>();

  constructor(deps: {
    codexApi: CodexApi;
    runtimeConfigProvider: RuntimeConfigProvider;
    threadBindingService: ThreadBindingService;
  }) {
    this.codexApi = deps.codexApi;
    this.runtimeConfigProvider = deps.runtimeConfigProvider;
    this.threadBindingService = deps.threadBindingService;
  }

  private normalizeRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
    const sandboxMap: Record<string, string> = {
      "workspace-write": "workspaceWrite",
      "read-only": "readOnly",
      "danger-full-access": "dangerFullAccess"
    };

    const sandbox = config.sandbox ? (sandboxMap[config.sandbox] ?? config.sandbox) : config.sandbox;
    return {
      ...config,
      sandbox
    };
  }

  private getThreadLockKey(projectId: string, chatId: string): string {
    return `${projectId}:${chatId}`;
  }

  async ensureThread(projectId: string, chatId: string): Promise<{ threadId: string; created: boolean }> {
    const lockKey = this.getThreadLockKey(projectId, chatId);
    const existingLock = this.ensureThreadLocks.get(lockKey);
    if (existingLock) {
      return existingLock;
    }

    const lock = (async () => {
      const existing = await this.threadBindingService.get(projectId, chatId);
      if (existing) {
        return { threadId: existing.threadId, created: false };
      }

      const runtimeConfig = await this.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
      const config = this.normalizeRuntimeConfig(runtimeConfig);
      const created = await this.codexApi.threadStart(config);
      await this.threadBindingService.bind(projectId, chatId, created.thread.id);
      return { threadId: created.thread.id, created: true };
    })();

    this.ensureThreadLocks.set(lockKey, lock);
    try {
      return await lock;
    } finally {
      if (this.ensureThreadLocks.get(lockKey) === lock) {
        this.ensureThreadLocks.delete(lockKey);
      }
    }
  }

  async handleUserText(
    projectId: string,
    chatId: string,
    text: string,
    traceId?: string
  ): Promise<{ threadId: string; turnId: string }> {
    const { threadId, created } = await this.ensureThread(projectId, chatId);
    let turn: { turn: { id: string } };
    const turnStartParams: {
      threadId: string;
      traceId?: string;
      input: Array<{ type: "text"; text: string }>;
    } = {
      threadId,
      input: [
        {
          type: "text",
          text
        }
      ]
    };
    if (traceId) {
      turnStartParams.traceId = traceId;
    }
    try {
      turn = await this.codexApi.turnStart(turnStartParams);
    } catch (error) {
      if (created) {
        await this.threadBindingService.unbind(projectId, chatId);
      }
      throw error;
    }

    return {
      threadId,
      turnId: turn.turn.id
    };
  }

  async handleThreadNew(projectId: string, chatId: string): Promise<{ threadId: string }> {
    const runtimeConfig = await this.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
    const config = this.normalizeRuntimeConfig(runtimeConfig);
    const created = await this.codexApi.threadStart(config);
    await this.threadBindingService.bind(projectId, chatId, created.thread.id);
    return { threadId: created.thread.id };
  }

  async handleIntent(
    projectId: string,
    chatId: string,
    intent: ParsedIntent,
    text: string,
    traceId?: string
  ): Promise<{ mode: string; id: string }> {
    if (intent.intent === "THREAD_NEW") {
      const created = await this.handleThreadNew(projectId, chatId);
      return { mode: "thread", id: created.threadId };
    }

    const result = await this.handleUserText(projectId, chatId, text, traceId);
    return { mode: "turn", id: result.turnId };
  }
}
