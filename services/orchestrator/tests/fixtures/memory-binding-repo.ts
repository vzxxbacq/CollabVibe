import type { ThreadBinding, ThreadBindingRepository } from "../../src/types";

function keyOf(projectId: string, chatId: string): string {
  return `${projectId}:${chatId}`;
}

export class MemoryBindingRepository implements ThreadBindingRepository {
  private readonly store = new Map<string, ThreadBinding>();

  constructor(seed: ThreadBinding[] = []) {
    for (const binding of seed) {
      this.store.set(keyOf(binding.projectId, binding.chatId), binding);
    }
  }

  async get(projectId: string, chatId: string): Promise<ThreadBinding | null> {
    return this.store.get(keyOf(projectId, chatId)) ?? null;
  }

  async set(binding: ThreadBinding): Promise<void> {
    this.store.set(keyOf(binding.projectId, binding.chatId), binding);
  }

  async delete(projectId: string, chatId: string): Promise<void> {
    this.store.delete(keyOf(projectId, chatId));
  }
}
