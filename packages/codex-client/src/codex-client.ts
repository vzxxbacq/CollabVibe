import { JsonRpcClient } from "./rpc-client";
import type {
  InitializeParams,
  ThreadResult,
  ThreadStartParams,
  TurnResult,
  TurnStartParams
} from "./types";

export class CodexClient {
  private readonly rpc: JsonRpcClient;

  constructor(rpc: JsonRpcClient) {
    this.rpc = rpc;
  }

  async initialize(params: InitializeParams): Promise<void> {
    await this.rpc.initialize(params);
  }

  async threadStart(params: ThreadStartParams): Promise<ThreadResult> {
    return this.rpc.call<ThreadResult>("thread/start", params as unknown as Record<string, unknown>);
  }

  async threadResume(threadId: string): Promise<ThreadResult> {
    return this.rpc.call<ThreadResult>("thread/resume", { threadId });
  }

  async threadFork(threadId: string): Promise<ThreadResult> {
    return this.rpc.call<ThreadResult>("thread/fork", { threadId });
  }

  async turnStart(params: TurnStartParams): Promise<TurnResult> {
    return this.rpc.call<TurnResult>("turn/start", params as unknown as Record<string, unknown>);
  }

  async turnInterrupt(threadId: string, turnId: string): Promise<void> {
    await this.rpc.call("turn/interrupt", { threadId, turnId });
  }
}
