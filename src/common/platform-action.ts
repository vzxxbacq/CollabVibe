import type { PlatformId } from "./platform-input";

interface PlatformActionBase {
  platform: PlatformId;
  chatId: string;
  actorId: string;
  raw?: unknown;
}

export interface ApprovalDecisionAction extends PlatformActionBase {
  kind: "approval_decision";
  approvalId: string;
  decision: "approve" | "deny" | "approve_always";
  threadId?: string;
  turnId?: string;
  approvalType?: "command_exec" | "file_change";
}

export interface ThreadCreateAction extends PlatformActionBase {
  kind: "thread_create";
  threadName: string;
  backendId?: string;
  model?: string;
}

export interface ThreadJoinAction extends PlatformActionBase {
  kind: "thread_join";
  threadName: string;
  fromHelp?: boolean;
}

export interface ThreadLeaveAction extends PlatformActionBase {
  kind: "thread_leave";
  fromHelp?: boolean;
}

export interface MergeFileDecisionAction extends PlatformActionBase {
  kind: "merge_file_decision";
  branchName: string;
  filePath: string;
  decision: "accept" | "keep_main" | "use_branch" | "skip";
}

export interface AdminUserToggleAction extends PlatformActionBase {
  kind: "admin_user_toggle";
  targetUserId: string;
  promote: boolean;
}

export interface UserInputReplyAction extends PlatformActionBase {
  kind: "user_input_reply";
  callId: string;
}

export interface InterruptTurnAction extends PlatformActionBase {
  kind: "turn_interrupt";
  turnId?: string;
  threadName?: string;
}

export interface AcceptTurnAction extends PlatformActionBase {
  kind: "turn_accept";
  turnId: string;
}

export interface RevertTurnAction extends PlatformActionBase {
  kind: "turn_revert";
  turnId: string;
}

export interface MergeConfirmAction extends PlatformActionBase {
  kind: "merge_confirm";
  branchName: string;
}

export interface MergeCancelAction extends PlatformActionBase {
  kind: "merge_cancel";
  branchName: string;
  baseBranch?: string;
}

export interface MergeReviewCancelAction extends PlatformActionBase {
  kind: "merge_review_cancel";
  branchName: string;
  baseBranch?: string;
}

export interface MergeReviewStartAction extends PlatformActionBase {
  kind: "merge_review_start";
  branchName: string;
  baseBranch?: string;
}

export interface MergePreviewAction extends PlatformActionBase {
  kind: "merge_preview";
  branchName: string;
}

export interface MergeRetryFileAction extends PlatformActionBase {
  kind: "merge_retry_file";
  branchName: string;
  filePath: string;
}

export interface MergeReviewOpenFileDetailAction extends PlatformActionBase {
  kind: "merge_review_open_file_detail";
  branchName: string;
}

export interface MergeReviewBackOverviewAction extends PlatformActionBase {
  kind: "merge_review_back_overview";
  branchName: string;
}

export interface MergeReviewAgentAssistFormAction extends PlatformActionBase {
  kind: "merge_review_agent_assist_form";
  branchName: string;
}

export interface TurnViewFileChangesAction extends PlatformActionBase {
  kind: "turn_view_file_changes";
  turnId: string;
  page?: number;
  targetChatId?: string;
}

export interface TurnFileChangesBackAction extends PlatformActionBase {
  kind: "turn_file_changes_back";
  turnId: string;
  targetChatId?: string;
}

export interface TurnViewToolProgressAction extends PlatformActionBase {
  kind: "turn_view_tool_progress";
  turnId: string;
  page?: number;
  targetChatId?: string;
}

export interface TurnToolProgressBackAction extends PlatformActionBase {
  kind: "turn_tool_progress_back";
  turnId: string;
  targetChatId?: string;
}

export interface TurnViewDetailAction extends PlatformActionBase {
  kind: "turn_view_detail";
  turnId: string;
  targetChatId?: string;
}

export interface SnapshotJumpAction extends PlatformActionBase {
  kind: "snapshot_jump";
  threadId?: string;
  turnId: string;
  ownerId?: string;
}

export interface HelpSkillInstallAction extends PlatformActionBase {
  kind: "help_skill_install";
  skillName: string;
}

export interface HelpSkillRemoveAction extends PlatformActionBase {
  kind: "help_skill_remove";
  name: string;
}

export interface AdminPanelAction extends PlatformActionBase {
  kind: "admin_panel";
  panel: "home" | "project" | "member" | "user" | "skill" | "backend";
}

export interface AdminUserPageAction extends PlatformActionBase {
  kind: "admin_user_page";
  page: number;
}

export interface MergeAcceptAllAction extends PlatformActionBase {
  kind: "merge_accept_all";
  branchName: string;
}

export interface MergeAgentAssistAction extends PlatformActionBase {
  kind: "merge_agent_assist";
  branchName: string;
  backendId?: string;
  model?: string;
  prompt?: string;
}

export interface MergeBatchRetryAction extends PlatformActionBase {
  kind: "merge_batch_retry";
  branchName: string;
  files: string[];
  feedback: string;
}

export interface MergeCommitAction extends PlatformActionBase {
  kind: "merge_commit";
  branchName: string;
}

export interface KeepMergedThreadAction extends PlatformActionBase {
  kind: "keep_merged_thread";
  branchName: string;
}

export interface DeleteMergedThreadAction extends PlatformActionBase {
  kind: "delete_merged_thread";
  branchName: string;
  projectId: string;
}

export interface HelpPanelAction extends PlatformActionBase {
  kind: "help_panel";
  panel: "help_home" | "help_threads" | "help_history" | "help_skills" | "help_backends" | "help_turns" | "help_merge" | "help_project";
  messageId?: string;
}

export interface HelpProjectPushAction extends PlatformActionBase {
  kind: "help_project_push";
  projectId: string;
  messageId?: string;
}

export interface HelpThreadNewAction extends PlatformActionBase {
  kind: "help_thread_new";
  messageId?: string;
}

export interface PlatformRawAction extends PlatformActionBase {
  kind: "raw";
  actionId: string;
}

// ── Project Init / Bind ──────────────────────────────────────────────────────

export interface InitProjectAction extends PlatformActionBase {
  kind: "init_project";
}

export interface InitProjectFileOpenAction extends PlatformActionBase {
  kind: "init_project_file_open";
  fileKey: "agents_md" | "gitignore";
}

export interface InitProjectFileSaveAction extends PlatformActionBase {
  kind: "init_project_file_save";
  fileKey: "agents_md" | "gitignore";
}

export interface InitProjectFileResetTemplateAction extends PlatformActionBase {
  kind: "init_project_file_reset_template";
  fileKey: "agents_md" | "gitignore";
}

export interface InitRootMenuAction extends PlatformActionBase {
  kind: "init_root_menu";
}

export interface InitBindMenuAction extends PlatformActionBase {
  kind: "init_bind_menu";
}

export interface InitCreateMenuAction extends PlatformActionBase {
  kind: "init_create_menu";
}

export interface InitBindExistingAction extends PlatformActionBase {
  kind: "init_bind_existing";
  projectId: string;
}

// ── In-help skill install ────────────────────────────────────────────────────

export interface InstallSkillAction extends PlatformActionBase {
  kind: "install_skill";
}

// ── Admin Project Management ─────────────────────────────────────────────────

export interface AdminProjectEditAction extends PlatformActionBase {
  kind: "admin_project_edit";
  projectId: string;
}

export interface AdminProjectSaveAction extends PlatformActionBase {
  kind: "admin_project_save";
  projectId: string;
}

export interface AdminProjectToggleAction extends PlatformActionBase {
  kind: "admin_project_toggle";
  projectId: string;
}

export interface AdminProjectUnbindAction extends PlatformActionBase {
  kind: "admin_project_unbind";
  projectId: string;
}

export interface AdminProjectDeleteAction extends PlatformActionBase {
  kind: "admin_project_delete";
  projectId: string;
}

export interface AdminProjectMembersAction extends PlatformActionBase {
  kind: "admin_project_members";
  projectId: string;
}

export interface AdminSearchProjectAction extends PlatformActionBase {
  kind: "admin_search_project";
}

export interface AdminSearchMemberAction extends PlatformActionBase {
  kind: "admin_search_member";
}

export interface AdminSearchUserAction extends PlatformActionBase {
  kind: "admin_search_user";
}

// ── Admin Member / User / Role ───────────────────────────────────────────────

export interface AdminMemberRoleChangeAction extends PlatformActionBase {
  kind: "admin_member_role_change";
  projectId: string;
  targetUserId: string;
}

export interface HelpRoleChangeAction extends PlatformActionBase {
  kind: "help_role_change";
  projectId: string;
  targetUserId: string;
}

// ── Admin Skill Management ───────────────────────────────────────────────────

export interface AdminSkillInstallOpenAction extends PlatformActionBase {
  kind: "admin_skill_install_open";
}

export interface AdminSkillFileInstallOpenAction extends PlatformActionBase {
  kind: "admin_skill_file_install_open";
}

export interface AdminSkillInstallSubmitAction extends PlatformActionBase {
  kind: "admin_skill_install_submit";
}

export interface AdminSkillFileInstallSubmitAction extends PlatformActionBase {
  kind: "admin_skill_file_install_submit";
}

export interface AdminSkillFileInstallConfirmAction extends PlatformActionBase {
  kind: "admin_skill_file_install_confirm";
}

export interface AdminSkillFileInstallCancelAction extends PlatformActionBase {
  kind: "admin_skill_file_install_cancel";
}

export interface AdminSkillBindAction extends PlatformActionBase {
  kind: "admin_skill_bind";
  pluginName: string;
}

export interface AdminSkillUnbindAction extends PlatformActionBase {
  kind: "admin_skill_unbind";
  pluginName: string;
}

// ── Admin Backend Config ─────────────────────────────────────────────────────

export interface AdminBackendEditAction extends PlatformActionBase {
  kind: "admin_backend_edit";
  backend: string;
}

export interface AdminBackendPolicyEditAction extends PlatformActionBase {
  kind: "admin_backend_policy_edit";
  backend: string;
}

export interface AdminBackendPolicySaveAction extends PlatformActionBase {
  kind: "admin_backend_policy_save";
  backend: string;
}

export interface AdminBackendAddProviderFormAction extends PlatformActionBase {
  kind: "admin_backend_add_provider_form";
  backend: string;
}

export interface AdminBackendAddProviderAction extends PlatformActionBase {
  kind: "admin_backend_add_provider";
  backend: string;
}

export interface AdminBackendRemoveProviderAction extends PlatformActionBase {
  kind: "admin_backend_remove_provider";
  backend: string;
  provider: string;
}

export interface AdminBackendModelManageAction extends PlatformActionBase {
  kind: "admin_backend_model_manage";
  backend: string;
}

export interface AdminBackendValidateModelAction extends PlatformActionBase {
  kind: "admin_backend_validate_model";
  backend: string;
  provider: string;
}

export interface AdminBackendRemoveModelAction extends PlatformActionBase {
  kind: "admin_backend_remove_model";
  backend: string;
  provider: string;
  model: string;
}

export interface AdminBackendRecheckAction extends PlatformActionBase {
  kind: "admin_backend_recheck";
  backend: string;
  provider: string;
}

export interface AdminBackendAddProfileAction extends PlatformActionBase {
  kind: "admin_backend_add_profile";
  backend: string;
}

export interface AdminBackendRemoveProfileAction extends PlatformActionBase {
  kind: "admin_backend_remove_profile";
  backend: string;
  profileName: string;
}

export type PlatformAction =
  | ApprovalDecisionAction
  | ThreadCreateAction
  | ThreadJoinAction
  | ThreadLeaveAction
  | MergeFileDecisionAction
  | AdminUserToggleAction
  | UserInputReplyAction
  | InterruptTurnAction
  | AcceptTurnAction
  | RevertTurnAction
  | MergeConfirmAction
  | MergeCancelAction
  | MergeReviewCancelAction
  | MergeReviewStartAction
  | MergePreviewAction
  | MergeRetryFileAction
  | MergeReviewOpenFileDetailAction
  | MergeReviewBackOverviewAction
  | MergeReviewAgentAssistFormAction
  | TurnViewFileChangesAction
  | TurnFileChangesBackAction
  | TurnViewToolProgressAction
  | TurnToolProgressBackAction
  | TurnViewDetailAction
  | SnapshotJumpAction
  | HelpSkillInstallAction
  | HelpSkillRemoveAction
  | AdminPanelAction
  | AdminUserPageAction
  | MergeAcceptAllAction
  | MergeAgentAssistAction
  | MergeBatchRetryAction
  | MergeCommitAction
  | KeepMergedThreadAction
  | DeleteMergedThreadAction
  | HelpPanelAction
  | HelpProjectPushAction
  | HelpThreadNewAction
  // Project init / bind
  | InitProjectAction
  | InitProjectFileOpenAction
  | InitProjectFileSaveAction
  | InitProjectFileResetTemplateAction
  | InitRootMenuAction
  | InitBindMenuAction
  | InitCreateMenuAction
  | InitBindExistingAction
  | InstallSkillAction
  // Admin project
  | AdminProjectEditAction
  | AdminProjectSaveAction
  | AdminProjectToggleAction
  | AdminProjectUnbindAction
  | AdminProjectDeleteAction
  | AdminProjectMembersAction
  | AdminSearchProjectAction
  | AdminSearchMemberAction
  | AdminSearchUserAction
  // Admin member / role
  | AdminMemberRoleChangeAction
  | HelpRoleChangeAction
  // Admin skill
  | AdminSkillInstallOpenAction
  | AdminSkillFileInstallOpenAction
  | AdminSkillInstallSubmitAction
  | AdminSkillFileInstallSubmitAction
  | AdminSkillFileInstallConfirmAction
  | AdminSkillFileInstallCancelAction
  | AdminSkillBindAction
  | AdminSkillUnbindAction
  // Admin backend
  | AdminBackendEditAction
  | AdminBackendPolicyEditAction
  | AdminBackendPolicySaveAction
  | AdminBackendAddProviderFormAction
  | AdminBackendAddProviderAction
  | AdminBackendRemoveProviderAction
  | AdminBackendModelManageAction
  | AdminBackendValidateModelAction
  | AdminBackendRemoveModelAction
  | AdminBackendRecheckAction
  | AdminBackendAddProfileAction
  | AdminBackendRemoveProfileAction
  | PlatformRawAction;

export interface PlatformActionAdapter {
  toAction(event: unknown): PlatformAction | null;
}
