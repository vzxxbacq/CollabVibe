import type { BackendIdentity } from "../../../../packages/agent-core/src/backend-identity";

export interface RuntimeDefaults {
  defaultBackend: BackendIdentity;
  cwd: string;
  sandbox: string;
  approvalPolicy: string;
}

