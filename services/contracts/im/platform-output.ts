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

export interface TextOutput {
  kind: "text";
  text: string;
}

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

export interface MergeOperationOutput {
  kind: "thread_merge";
  data: IMThreadMergeOperation;
}

export interface MergeReviewOutput {
  kind: "merge_review";
  data: IMFileMergeReview;
}

export interface MergeSummaryOutput {
  kind: "merge_summary";
  data: IMMergeSummary;
}

export interface MergeTimeoutOutput {
  kind: "merge_timeout";
  chatId: string;
  branchName: string;
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

export type PlatformOutput =
  | TextOutput
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
  | MergeOperationOutput
  | MergeReviewOutput
  | MergeSummaryOutput
  | MergeTimeoutOutput
  | ThreadNewFormOutput
  | ApprovalRequestOutput
  | UserInputRequestOutput
  | TurnSummaryOutput
  | HelpPanelOutput
  | TurnDetailOutput
  | AdminPanelOutput;

export interface OutputGateway {
  dispatch(chatId: string, output: PlatformOutput): Promise<void>;
}
