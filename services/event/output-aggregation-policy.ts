import type { PlatformOutput } from './output-contracts';

export type AggregationMode = 'no_merge' | 'latest' | 'append_window';

const KIND_AGGREGATION_WINDOW_MS = 5000;

export interface AggregationDecision {
  mode: AggregationMode;
  collapseKey?: string;
  windowMs?: number;
  maxWaitMs?: number;
}

function turnScopedKey(projectId: string, output: Extract<PlatformOutput, { data: { turnId?: string } }>, suffix: string): string | undefined {
  const turnId = typeof output.data.turnId === 'string' ? output.data.turnId : undefined;
  if (!turnId) return undefined;
  return `${projectId}:${suffix}:${turnId}`;
}

export function classifyPlatformOutput(projectId: string, output: PlatformOutput): AggregationDecision {
  switch (output.kind) {
    case 'content':
      return {
        mode: 'append_window',
        collapseKey: turnScopedKey(projectId, output, 'content'),
        windowMs: KIND_AGGREGATION_WINDOW_MS,
        maxWaitMs: KIND_AGGREGATION_WINDOW_MS,
      };
    case 'reasoning':
      return {
        mode: 'append_window',
        collapseKey: turnScopedKey(projectId, output, 'reasoning'),
        windowMs: KIND_AGGREGATION_WINDOW_MS,
        maxWaitMs: KIND_AGGREGATION_WINDOW_MS,
      };
    case 'plan':
      return {
        mode: 'append_window',
        collapseKey: turnScopedKey(projectId, output, 'plan'),
        windowMs: KIND_AGGREGATION_WINDOW_MS,
        maxWaitMs: KIND_AGGREGATION_WINDOW_MS,
      };
    case 'tool_output':
      return {
        mode: 'append_window',
        collapseKey: `${projectId}:tool_output:${output.data.turnId}:${output.data.callId}`,
        windowMs: KIND_AGGREGATION_WINDOW_MS,
        maxWaitMs: KIND_AGGREGATION_WINDOW_MS,
      };
    case 'progress':
      return {
        mode: 'latest',
        collapseKey: `${projectId}:progress:${output.data.turnId}`,
        windowMs: KIND_AGGREGATION_WINDOW_MS,
        maxWaitMs: KIND_AGGREGATION_WINDOW_MS,
      };
    case 'plan_update':
      return {
        mode: 'latest',
        collapseKey: turnScopedKey(projectId, output, 'plan_update'),
        windowMs: KIND_AGGREGATION_WINDOW_MS,
        maxWaitMs: KIND_AGGREGATION_WINDOW_MS,
      };
    case 'notification':
      if (output.data.category === 'token_usage') {
        return {
          mode: 'latest',
          collapseKey: `${projectId}:token_usage:${output.data.turnId ?? output.data.threadId}`,
          windowMs: KIND_AGGREGATION_WINDOW_MS,
          maxWaitMs: KIND_AGGREGATION_WINDOW_MS,
        };
      }
      return { mode: 'no_merge' };
    case 'platform_mutation':
      return { mode: 'no_merge' };
    default:
      return { mode: 'no_merge' };
  }
}
