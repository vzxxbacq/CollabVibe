export type ProjectRole = "maintainer" | "developer" | "auditor";

export interface ProjectConfig {
  id: string;
  name: string;
  chatId: string;
  cwd: string;
  defaultBranch?: string;
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
  projects: ProjectConfig[];
  members: Record<string, MemberRecord[]>;
}

export interface AdminStateStore {
  read(): AdminPersistedState;
  write(state: AdminPersistedState): void;
}
