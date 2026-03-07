export interface Project {
  id: string;
  orgId: string;
  name: string;
  defaultCwd: string;
  sandboxMode: string;
  approvalPolicy: string;
  status: "active" | "disabled";
}

export interface ProjectRepositoryPort {
  create(project: Project): Promise<void>;
  getById(id: string): Promise<Project | null>;
  listByOrg(orgId: string): Promise<Project[]>;
  updateStatus(id: string, status: "active" | "disabled"): Promise<void>;
  withTransaction<T>(work: (repo: ProjectRepositoryPort) => Promise<T>): Promise<T>;
}

export class ProjectRepository implements ProjectRepositoryPort {
  private readonly projects = new Map<string, Project>();

  private static hasOrgNameDuplicate(projects: Map<string, Project>, candidate: Project, ignoreId?: string): boolean {
    return [...projects.values()].some(
      (entry) => entry.orgId === candidate.orgId && entry.name === candidate.name && entry.id !== ignoreId
    );
  }

  async create(project: Project): Promise<void> {
    if (ProjectRepository.hasOrgNameDuplicate(this.projects, project)) {
      throw new Error("project already exists");
    }
    this.projects.set(project.id, project);
  }

  async getById(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async listByOrg(orgId: string): Promise<Project[]> {
    return [...this.projects.values()].filter((project) => project.orgId === orgId);
  }

  async updateStatus(id: string, status: "active" | "disabled"): Promise<void> {
    const project = this.projects.get(id);
    if (!project) {
      throw new Error("project not found");
    }
    this.projects.set(id, { ...project, status });
  }

  async withTransaction<T>(work: (repo: ProjectRepositoryPort) => Promise<T>): Promise<T> {
    const workingProjects = new Map(this.projects);
    const changedIds = new Set<string>();
    const createdIds = new Set<string>();

    const txRepo: ProjectRepositoryPort = {
      create: async (project) => {
        if (ProjectRepository.hasOrgNameDuplicate(workingProjects, project)) {
          throw new Error("project already exists");
        }
        workingProjects.set(project.id, project);
        changedIds.add(project.id);
        createdIds.add(project.id);
      },
      getById: async (id) => {
        return workingProjects.get(id) ?? null;
      },
      listByOrg: async (orgId) => {
        return [...workingProjects.values()].filter((project) => project.orgId === orgId);
      },
      updateStatus: async (id, status) => {
        const project = workingProjects.get(id);
        if (!project) {
          throw new Error("project not found");
        }
        workingProjects.set(id, { ...project, status });
        changedIds.add(id);
      },
      withTransaction: async <R>(nestedWork: (repo: ProjectRepositoryPort) => Promise<R>): Promise<R> => {
        return nestedWork(txRepo);
      }
    };

    const result = await work(txRepo);

    for (const id of changedIds) {
      const project = workingProjects.get(id);
      if (!project) {
        continue;
      }

      if (createdIds.has(id)) {
        if (this.projects.has(id) || ProjectRepository.hasOrgNameDuplicate(this.projects, project, id)) {
          throw new Error("project already exists");
        }
        continue;
      }

      if (!this.projects.has(id)) {
        throw new Error("project not found");
      }
    }

    for (const id of changedIds) {
      const project = workingProjects.get(id);
      if (!project) {
        continue;
      }
      this.projects.set(id, project);
    }

    return result;
  }
}
