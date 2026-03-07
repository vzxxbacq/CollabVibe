import type { ThreadBinding, ThreadBindingRepository } from "./types";

export class ThreadBindingService {
  private readonly repo: ThreadBindingRepository;

  constructor(repo: ThreadBindingRepository) {
    this.repo = repo;
  }

  async get(projectId: string, chatId: string): Promise<ThreadBinding | null> {
    return this.repo.get(projectId, chatId);
  }

  async bind(projectId: string, chatId: string, threadId: string): Promise<void> {
    await this.repo.set({ projectId, chatId, threadId });
  }

  async unbind(projectId: string, chatId: string): Promise<void> {
    await this.repo.delete(projectId, chatId);
  }
}
