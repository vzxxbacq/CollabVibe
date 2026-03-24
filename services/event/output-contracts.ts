import type {
  IMContentChunk,
  IMApprovalRequest,
  IMConfigOperation,
  IMFileMergeReview,
  IMMergeSummary,
  IMNotification,
  IMPlanChunk,
  IMPlanUpdate,
  IMProgressEvent,
  IMReasoningChunk,
  IMSkillOperation,
  IMSnapshotOperation,
  IMThreadMergeOperation,
  IMThreadNewFormData,
  IMThreadOperation,
  IMToolOutputChunk,
  IMTurnSummary,
  IMUserInputRequest,
} from "./im-output";

export interface IMErrorPayload {
  code: string;
  message: string;
  source: "agent" | "orchestrator";
  turnId?: string;
}

export type IMMergeEventPayload =
  | { action: "resolver_done"; projectId?: string; branchName: string; review: IMFileMergeReview }
  | { action: "resolver_complete"; operation: IMThreadMergeOperation }
  | { action: "timeout"; projectId?: string; branchName: string };

export interface ContentOutput {
  kind: "content";
  data: IMContentChunk;
}

export interface ReasoningOutput {
  kind: "reasoning";
  data: IMReasoningChunk;
}

export interface PlanOutput {
  kind: "plan";
  data: IMPlanChunk;
}

export interface PlanUpdateOutput {
  kind: "plan_update";
  data: IMPlanUpdate;
}

export interface ToolOutputDelta {
  kind: "tool_output";
  data: IMToolOutputChunk;
}

export interface ProgressOutput {
  kind: "progress";
  data: IMProgressEvent;
}

export interface NotificationOutput {
  kind: "notification";
  data: IMNotification;
}

export interface ThreadOperationOutput {
  kind: "thread_operation";
  data: IMThreadOperation;
}

export interface SnapshotOperationOutput {
  kind: "snapshot_operation";
  data: IMSnapshotOperation;
  userId?: string;
}

export interface ConfigOperationOutput {
  kind: "config_operation";
  data: IMConfigOperation;
  userId?: string;
}

export interface SkillOperationOutput {
  kind: "skill_operation";
  data: IMSkillOperation;
}

export interface ErrorOutput {
  kind: "error";
  data: IMErrorPayload;
}

export interface MergeEventOutput {
  kind: "merge_event";
  data: IMMergeEventPayload;
}

export interface ThreadNewFormOutput {
  kind: "thread_new_form";
  data: IMThreadNewFormData;
}

export interface ApprovalRequestOutput {
  kind: "approval_request";
  data: IMApprovalRequest;
}

export interface UserInputRequestOutput {
  kind: "user_input_request";
  data: IMUserInputRequest;
}

export interface TurnSummaryOutput {
  kind: "turn_summary";
  data: IMTurnSummary;
}

export interface HelpPanelOutput {
  kind: "help_panel";
  panel: unknown;
}

export interface TurnDetailOutput {
  kind: "turn_detail";
  detail: unknown;
}

export interface AdminPanelOutput {
  kind: "admin_panel";
  panel: unknown;
}

export interface AsyncPlatformMutationOutput {
  kind: "platform_mutation";
  data: {
    mutationType: import("./output-priority").AsyncPlatformMutationType;
    platform: "feishu" | "slack";
    chatId: string;
    messageId?: string;
    payload: unknown;
  };
}

export type PlatformOutput =
  | ContentOutput
  | ReasoningOutput
  | PlanOutput
  | PlanUpdateOutput
  | ToolOutputDelta
  | ProgressOutput
  | NotificationOutput
  | ThreadOperationOutput
  | SnapshotOperationOutput
  | ConfigOperationOutput
  | SkillOperationOutput
  | ErrorOutput
  | MergeEventOutput
  | ThreadNewFormOutput
  | ApprovalRequestOutput
  | UserInputRequestOutput
  | TurnSummaryOutput
  | HelpPanelOutput
  | TurnDetailOutput
  | AdminPanelOutput
  | AsyncPlatformMutationOutput;

export interface OutputGateway {
  /** Promise resolves when the output has been accepted by L1 delivery queue; it does not imply network delivery completed. */
  dispatch(projectId: string, output: PlatformOutput): Promise<void>;
  /** Optional graceful-shutdown hook for waiting on queued L1 deliveries. */
  flushAll?(): Promise<void>;
}
