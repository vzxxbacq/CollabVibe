import type { AgentApi, BackendId } from "../../packages/agent-core/src/index";

export interface CreateThreadOptions {
  backendId: BackendId;
  model: string;
  profileName?: string;
  serverCmd?: string;
  cwd?: string;
  approvalPolicy?: string;
}

export interface CreateThreadResult {
  threadId: string;
  threadName: string;
  cwd: string;
  api: AgentApi;
}

export interface ThreadListResult {
  threadName: string;
  threadId?: string;
  status: "creating" | "active";
  backendId: BackendId;
  model: string;
}
