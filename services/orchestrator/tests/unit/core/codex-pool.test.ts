import { describe, expect, it, vi } from 'vitest';

import { createBackendIdentity } from '../../../../../packages/agent-core/src/backend-identity';
import { DefaultAgentApiPool } from '../../../src/session/agent-api-pool';

const runtimeConfig = {
  cwd: '/repo',
  approvalPolicy: 'on-request' as const,
  sandbox: 'workspace-write' as const,
  backend: createBackendIdentity('codex', 'gpt-5-codex')
};

describe('codex-pool', () => {
  it('caches by chat + thread and recreates after releaseThread', async () => {
    const create = vi.fn(async () => ({ backendType: 'codex' as const }));
    const dispose = vi.fn(async () => undefined);
    const pool = new DefaultAgentApiPool({ apiFactory: { create, dispose } as never });

    const first = await pool.createWithConfig('chat-1', '__main__', runtimeConfig as never);
    const second = await pool.createWithConfig('chat-1', '__main__', runtimeConfig as never);
    expect(first).toBe(second);
    expect(pool.getLifecycleState('chat-1')).toBe('READY');
    expect(create).toHaveBeenCalledTimes(1);

    await pool.releaseThread('chat-1', '__main__');
    const third = await pool.createWithConfig('chat-1', '__main__', runtimeConfig as never);
    expect(third).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('moves to FAILED state when createWithConfig throws', async () => {
    const pool = new DefaultAgentApiPool({
      apiFactory: {
        create: vi.fn(async () => {
          throw new Error('boot failed');
        })
      } as never
    });

    await expect(pool.createWithConfig('chat-2', '__main__', runtimeConfig as never)).rejects.toThrowError('boot failed');
    expect(pool.getLifecycleState('chat-2')).toBe('FAILED');
  });

  it('returns health summary from cached entries', async () => {
    const pool = new DefaultAgentApiPool({
      apiFactory: {
        create: vi.fn(async () => ({ backendType: 'codex' as const }))
      } as never
    });

    expect(await pool.healthCheck('chat-3')).toEqual({ alive: false, threadCount: 0 });
    await pool.createWithConfig('chat-3', '__main__', runtimeConfig as never);
    expect(await pool.healthCheck('chat-3')).toEqual({ alive: true, threadCount: 1 });
  });

  it('stops the process manager when releasing a thread entry', async () => {
    const processManager = {
      stop: vi.fn(async () => undefined)
    };
    const pool = new DefaultAgentApiPool({
      apiFactory: {
        create: vi.fn(async () => ({ backendType: 'codex' as const })),
        dispose: vi.fn(async () => undefined)
      } as never,
      processManager: processManager as never
    });

    await pool.createWithConfig('chat-9', '__main__', {
      ...runtimeConfig,
      serverCmd: 'codex app-server',
      serverPort: 3301
    } as never);
    await pool.releaseThread('chat-9', '__main__');

    expect(processManager.stop).toHaveBeenCalledWith('chat-9:__main__');
  });
});
