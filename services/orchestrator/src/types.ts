export interface RuntimeConfig {
  model: string;
  cwd?: string;
  sandbox?: string;
  approvalPolicy?: string;
  personality?: string;
  serviceName?: string;
}

export interface CodexApi {
  threadStart(params: RuntimeConfig): Promise<{ thread: { id: string } }>;
  turnStart(params: {
    threadId: string;
    traceId?: string;
    input: Array<{ type: "text"; text: string }>;
  }): Promise<{ turn: { id: string } }>;
}

export interface RuntimeConfigProvider {
  getProjectRuntimeConfig(projectId: string): Promise<RuntimeConfig>;
}

export interface ThreadBinding {
  projectId: string;
  chatId: string;
  threadId: string;
}

export interface ThreadBindingRepository {
  get(projectId: string, chatId: string): Promise<ThreadBinding | null>;
  set(binding: ThreadBinding): Promise<void>;
  delete(projectId: string, chatId: string): Promise<void>;
}
