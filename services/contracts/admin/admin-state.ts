export type ProjectRole = "maintainer" | "developer" | "auditor";

export interface ProjectRecord {
  id: string;
  name: string;
  chatId: string;
  cwd: string;
  defaultBranch: string;
  workBranch: string;
  enabledSkills?: string[];
  gitUrl?: string;
  sandbox: string;
  approvalPolicy: string;
  status: "active" | "disabled";
  createdAt?: string;
  updatedAt?: string;
}

export interface MemberRecord {
  userId: string;
  role: ProjectRole;
}

export interface AdminPersistedState {
  wizardStep: Record<string, number>;
  projects: ProjectRecord[];
  members: Record<string, MemberRecord[]>;
}

export interface AdminStateStore {
  read(): AdminPersistedState;
  write(state: AdminPersistedState): void;
}

/**
 * Subset of application config required by the orchestrator layer.
 * Defined at L3 (services) so orchestrator factory does not depend on L2 (src/config).
 * `AppConfig` in `src/config.ts` extends this interface.
 */
export interface OrchestratorConfig {
  cwd: string;
  /** Absolute path to the runtime data directory (logs, db, config). Derived from COLLABVIBE_WORKSPACE_CWD. */
  dataDir: string;
  sandbox: string;
  approvalPolicy: string;
  server: {
    port: number;
    approvalTimeoutMs: number;
    sysAdminUserIds: string[];
  };
}
