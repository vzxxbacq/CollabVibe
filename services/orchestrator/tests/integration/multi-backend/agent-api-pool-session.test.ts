import { describe, expect, it, vi } from 'vitest';

import { createBackendIdentity } from '../../../../../packages/agent-core/src/backend-identity';
import { DefaultAgentApiPool } from '../../../src/session/agent-api-pool';

describe('agent api pool session scope', () => {
  it('isolates instances per thread key', async () => {
    let callCount = 0;
    const create = vi.fn(async ({ threadName }: { threadName: string }) => ({
      backendType: 'codex' as const,
      instanceId: `${threadName}-${++callCount}`,
      threadStart: vi.fn(async () => ({ thread: { id: `thr-${callCount}` } })),
      turnStart: vi.fn(async () => ({ turn: { id: `turn-${callCount}` } }))
    }));

    const pool = new DefaultAgentApiPool({ apiFactory: { create } as never });
    const baseConfig = { backend: createBackendIdentity('codex', 'gpt-5-codex'), cwd: '/repo' };

    const threadA = await pool.createWithConfig('chat-1', 'thread-a', baseConfig as never);
    const threadB = await pool.createWithConfig('chat-1', 'thread-b', baseConfig as never);
    const threadAAgain = await pool.createWithConfig('chat-1', 'thread-a', baseConfig as never);

    expect(threadA).toBe(threadAAgain);
    expect(threadA).not.toBe(threadB);
    expect(create).toHaveBeenCalledTimes(2);

    await pool.releaseThread('chat-1', 'thread-a');
    const recreated = await pool.createWithConfig('chat-1', 'thread-a', baseConfig as never);
    expect(recreated).not.toBe(threadA);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('reuses the same API for the same thread key regardless of caller', async () => {
    const create = vi.fn(async () => ({
      backendType: 'codex' as const,
      threadStart: vi.fn(async () => ({ thread: { id: 'thr-1' } })),
      turnStart: vi.fn(async () => ({ turn: { id: 'turn-1' } }))
    }));

    const pool = new DefaultAgentApiPool({ apiFactory: { create } as never });
    const config = { backend: createBackendIdentity('codex', 'gpt-5-codex'), cwd: '/repo--shared-thread' };

    const fromFirstCall = await pool.createWithConfig('chat-1', 'shared-thread', config as never);
    const fromSecondCall = await pool.createWithConfig('chat-1', 'shared-thread', config as never);

    expect(fromFirstCall).toBe(fromSecondCall);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
