import type { PlatformOutput } from './output-contracts';

export type OutputPriority = 'p0_control' | 'p1_milestone' | 'p2_operational' | 'p3_stream';
export type AsyncPlatformMutationType = 'approval_result' | 'interrupt_result' | 'async_action_result' | 'async_action_failure' | 'turn_terminal_card';

export function priorityWeight(priority: OutputPriority): number {
  switch (priority) {
    case 'p0_control':
      return 0;
    case 'p1_milestone':
      return 1;
    case 'p2_operational':
      return 2;
    case 'p3_stream':
      return 3;
  }
}

export function priorityForPlatformOutput(output: PlatformOutput): OutputPriority {
  switch (output.kind) {
    case 'approval_request':
    case 'user_input_request':
    case 'turn_summary':
      return 'p1_milestone';
    case 'progress':
    case 'plan_update':
      return 'p2_operational';
    case 'notification':
      return output.data.category === 'token_usage' ? 'p2_operational' : 'p1_milestone';
    case 'content':
    case 'reasoning':
    case 'plan':
    case 'tool_output':
      return 'p3_stream';
    case 'platform_mutation':
      return priorityForMutationType(output.data.mutationType);
    default:
      return 'p1_milestone';
  }
}

export function priorityForMutationType(type: AsyncPlatformMutationType): OutputPriority {
  switch (type) {
    case 'approval_result':
    case 'interrupt_result':
    case 'async_action_result':
    case 'async_action_failure':
    case 'turn_terminal_card':
      return 'p0_control';
  }
}
