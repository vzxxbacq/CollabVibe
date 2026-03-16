import { vi } from "vitest";

import { createBackendIdentity } from "../../../../packages/agent-core/src/backend-identity";
import type { AgentApiPool, RuntimeConfigProvider } from "../../src/contracts";

export function makeRuntimeConfigProvider(overrides: {
  backendId?: "codex" | "opencode" | "claude-code";
  model?: string;
  cwd?: string;
  baseBranch?: string;
  sandbox?: string;
  approvalPolicy?: string;
} = {}): RuntimeConfigProvider {
  return {
    getProjectRuntimeConfig: vi.fn(async () => ({
      backend: createBackendIdentity(overrides.backendId ?? "codex", overrides.model ?? "gpt-5-codex"),
      cwd: overrides.cwd,
      baseBranch: overrides.baseBranch,
      sandbox: overrides.sandbox,
      approvalPolicy: overrides.approvalPolicy
    }))
  };
}

export function makeAgentApiPool(api: unknown, options?: { cached?: unknown; alive?: boolean; threadCount?: number }): AgentApiPool {
  return {
    createWithConfig: vi.fn(async () => api as never),
    get: vi.fn(() => (options?.cached ?? null) as never),
    releaseThread: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => ({ alive: options?.alive ?? true, threadCount: options?.threadCount ?? 0 }))
  };
}
