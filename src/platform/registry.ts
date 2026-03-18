import type { PlatformModule } from "./types";

export class PlatformModuleRegistry {
  private readonly modules = new Map<string, PlatformModule>();

  constructor(modules: PlatformModule[]) {
    for (const module of modules) {
      this.modules.set(module.platformId, module);
    }
  }

  get(platformId: string): PlatformModule {
    const module = this.modules.get(platformId);
    if (!module) {
      throw new Error(`unsupported platform module: ${platformId}`);
    }
    return module;
  }
}
