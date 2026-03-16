import type { UserThreadBinding, UserThreadBindingRepository } from "./user-thread-binding-types";
export type { UserThreadBinding, UserThreadBindingRepository } from "./user-thread-binding-types";

function keyOf(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

function requireProjectId(projectId?: string, chatId?: string): string {
  const key = projectId ?? chatId;
  if (!key) {
    throw new Error("UserThreadBinding requires projectId or legacy chatId");
  }
  return key;
}

class InMemoryUserThreadBindingRepository implements UserThreadBindingRepository {
  private readonly bindings = new Map<string, UserThreadBinding>();

  async bind(binding: UserThreadBinding): Promise<void> {
    this.bindings.set(keyOf(requireProjectId(binding.projectId, binding.chatId), binding.userId), binding);
  }

  async resolve(projectId: string, userId: string): Promise<UserThreadBinding | null> {
    return this.bindings.get(keyOf(projectId, userId)) ?? null;
  }

  async leave(projectId: string, userId: string): Promise<void> {
    this.bindings.delete(keyOf(projectId, userId));
  }
}

export class UserThreadBindingService {
  private readonly repo: UserThreadBindingRepository;

  constructor(repo?: UserThreadBindingRepository) {
    this.repo = repo ?? new InMemoryUserThreadBindingRepository();
  }

  async bind(binding: UserThreadBinding): Promise<void> {
    await this.repo.bind(binding);
  }

  async resolve(projectId: string, userId: string): Promise<UserThreadBinding | null> {
    return this.repo.resolve(projectId, userId);
  }

  async leave(projectId: string, userId: string): Promise<void> {
    await this.repo.leave(projectId, userId);
  }
}
