import type { BackendIdentity } from "../../packages/agent-core/src/index";

export interface RuntimeDefaults {
  defaultBackend: BackendIdentity;
  cwd: string;
  sandbox: string;
  approvalPolicy: string;
}
