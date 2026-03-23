import type {
  AcceptTurnAction,
  AdminPanelAction,
  AdminUserPageAction,
  AdminUserToggleAction,
  ApprovalDecisionAction,
  HelpPanelAction,
  HelpProjectPushAction,
  HelpSkillInstallAction,
  HelpSkillRemoveAction,
  HelpThreadNewAction,
  InterruptTurnAction,
  UserInputReplyAction,
  MergeAcceptAllAction,
  MergeAgentAssistAction,
  MergeBatchRetryAction,
  MergeCancelAction,
  MergeCommitAction,
  MergeConfirmAction,
  KeepMergedThreadAction,
  DeleteMergedThreadAction,
  MergeFileDecisionAction,
  MergeReviewCancelAction,
  MergePreviewAction,
  MergeRetryFileAction,
  MergeReviewOpenFileDetailAction,
  MergeReviewBackOverviewAction,
  MergeReviewAgentAssistFormAction,
  MergeReviewStartAction,
  SnapshotJumpAction,
  TurnFileChangesBackAction,
  TurnToolProgressBackAction,
  TurnViewDetailAction,
  TurnViewFileChangesAction,
  TurnViewToolProgressAction,
  PlatformAction,
  PlatformRawAction,
  RevertTurnAction,
  ThreadCreateAction,
  ThreadJoinAction,
  ThreadLeaveAction,
  // Project init / bind
  InitProjectAction,
  InitProjectFileOpenAction,
  InitProjectFileSaveAction,
  InitProjectFileResetTemplateAction,
  InitRootMenuAction,
  InitBindMenuAction,
  InitCreateMenuAction,
  InitBindExistingAction,
  InstallSkillAction,
  // Admin project
  AdminProjectEditAction,
  AdminProjectSaveAction,
  AdminProjectToggleAction,
  AdminProjectUnbindAction,
  AdminProjectDeleteAction,
  AdminProjectMembersAction,
  AdminSearchProjectAction,
  AdminSearchMemberAction,
  AdminSearchUserAction,
  // Admin member / role
  AdminMemberRoleChangeAction,
  HelpRoleChangeAction,
  // Admin skill
  AdminSkillInstallOpenAction,
  AdminSkillFileInstallOpenAction,
  AdminSkillInstallSubmitAction,
  AdminSkillFileInstallSubmitAction,
  AdminSkillFileInstallConfirmAction,
  AdminSkillFileInstallCancelAction,
  AdminSkillBindAction,
  AdminSkillUnbindAction,
  // Admin backend
  AdminBackendEditAction,
  AdminBackendPolicyEditAction,
  AdminBackendPolicySaveAction,
  AdminBackendAddProviderFormAction,
  AdminBackendAddProviderAction,
  AdminBackendRemoveProviderAction,
  AdminBackendModelManageAction,
  AdminBackendValidateModelAction,
  AdminBackendRemoveModelAction,
  AdminBackendRecheckAction,
  AdminBackendAddProfileAction,
  AdminBackendRemoveProfileAction,
} from "./platform-action";

export interface PlatformActionExecutor<Deps, Result = unknown> {
  approvalDecision?(deps: Deps, action: ApprovalDecisionAction): Promise<Result>;
  helpSkillInstall?(deps: Deps, action: HelpSkillInstallAction): Promise<Result>;
  helpSkillRemove?(deps: Deps, action: HelpSkillRemoveAction): Promise<Result>;
  adminPanel?(deps: Deps, action: AdminPanelAction): Promise<Result>;
  adminUserPage?(deps: Deps, action: AdminUserPageAction): Promise<Result>;
  userInputReply?(deps: Deps, action: UserInputReplyAction): Promise<Result>;
  threadCreate?(deps: Deps, action: ThreadCreateAction): Promise<Result>;
  threadJoin?(deps: Deps, action: ThreadJoinAction): Promise<Result>;
  threadLeave?(deps: Deps, action: ThreadLeaveAction): Promise<Result>;
  interruptTurn?(deps: Deps, action: InterruptTurnAction): Promise<Result>;
  acceptTurn?(deps: Deps, action: AcceptTurnAction): Promise<Result>;
  revertTurn?(deps: Deps, action: RevertTurnAction): Promise<Result>;
  mergeConfirm?(deps: Deps, action: MergeConfirmAction): Promise<Result>;
  mergeCancel?(deps: Deps, action: MergeCancelAction): Promise<Result>;
  mergeReviewCancel?(deps: Deps, action: MergeReviewCancelAction): Promise<Result>;
  mergeReviewStart?(deps: Deps, action: MergeReviewStartAction): Promise<Result>;
  mergePreview?(deps: Deps, action: MergePreviewAction): Promise<Result>;
  mergeRetryFile?(deps: Deps, action: MergeRetryFileAction): Promise<Result>;
  mergeReviewOpenFileDetail?(deps: Deps, action: MergeReviewOpenFileDetailAction): Promise<Result>;
  mergeReviewBackOverview?(deps: Deps, action: MergeReviewBackOverviewAction): Promise<Result>;
  mergeReviewAgentAssistForm?(deps: Deps, action: MergeReviewAgentAssistFormAction): Promise<Result>;
  turnViewFileChanges?(deps: Deps, action: TurnViewFileChangesAction): Promise<Result>;
  turnFileChangesBack?(deps: Deps, action: TurnFileChangesBackAction): Promise<Result>;
  turnViewToolProgress?(deps: Deps, action: TurnViewToolProgressAction): Promise<Result>;
  turnToolProgressBack?(deps: Deps, action: TurnToolProgressBackAction): Promise<Result>;
  turnViewDetail?(deps: Deps, action: TurnViewDetailAction): Promise<Result>;
  snapshotJump?(deps: Deps, action: SnapshotJumpAction): Promise<Result>;
  mergeFileDecision?(deps: Deps, action: MergeFileDecisionAction): Promise<Result>;
  mergeAcceptAll?(deps: Deps, action: MergeAcceptAllAction): Promise<Result>;
  mergeAgentAssist?(deps: Deps, action: MergeAgentAssistAction): Promise<Result>;
  mergeBatchRetry?(deps: Deps, action: MergeBatchRetryAction): Promise<Result>;
  mergeCommit?(deps: Deps, action: MergeCommitAction): Promise<Result>;
  keepMergedThread?(deps: Deps, action: KeepMergedThreadAction): Promise<Result>;
  deleteMergedThread?(deps: Deps, action: DeleteMergedThreadAction): Promise<Result>;
  adminUserToggle?(deps: Deps, action: AdminUserToggleAction): Promise<Result>;
  helpPanel?(deps: Deps, action: HelpPanelAction): Promise<Result>;
  helpProjectPush?(deps: Deps, action: HelpProjectPushAction): Promise<Result>;
  helpThreadNew?(deps: Deps, action: HelpThreadNewAction): Promise<Result>;
  // Project init / bind
  initProject?(deps: Deps, action: InitProjectAction): Promise<Result>;
  initProjectFileOpen?(deps: Deps, action: InitProjectFileOpenAction): Promise<Result>;
  initProjectFileSave?(deps: Deps, action: InitProjectFileSaveAction): Promise<Result>;
  initProjectFileResetTemplate?(deps: Deps, action: InitProjectFileResetTemplateAction): Promise<Result>;
  initRootMenu?(deps: Deps, action: InitRootMenuAction): Promise<Result>;
  initBindMenu?(deps: Deps, action: InitBindMenuAction): Promise<Result>;
  initCreateMenu?(deps: Deps, action: InitCreateMenuAction): Promise<Result>;
  initBindExisting?(deps: Deps, action: InitBindExistingAction): Promise<Result>;
  installSkill?(deps: Deps, action: InstallSkillAction): Promise<Result>;
  // Admin project
  adminProjectEdit?(deps: Deps, action: AdminProjectEditAction): Promise<Result>;
  adminProjectSave?(deps: Deps, action: AdminProjectSaveAction): Promise<Result>;
  adminProjectToggle?(deps: Deps, action: AdminProjectToggleAction): Promise<Result>;
  adminProjectUnbind?(deps: Deps, action: AdminProjectUnbindAction): Promise<Result>;
  adminProjectDelete?(deps: Deps, action: AdminProjectDeleteAction): Promise<Result>;
  adminProjectMembers?(deps: Deps, action: AdminProjectMembersAction): Promise<Result>;
  adminSearchProject?(deps: Deps, action: AdminSearchProjectAction): Promise<Result>;
  adminSearchMember?(deps: Deps, action: AdminSearchMemberAction): Promise<Result>;
  adminSearchUser?(deps: Deps, action: AdminSearchUserAction): Promise<Result>;
  // Admin member / role
  adminMemberRoleChange?(deps: Deps, action: AdminMemberRoleChangeAction): Promise<Result>;
  helpRoleChange?(deps: Deps, action: HelpRoleChangeAction): Promise<Result>;
  // Admin skill
  adminSkillInstallOpen?(deps: Deps, action: AdminSkillInstallOpenAction): Promise<Result>;
  adminSkillFileInstallOpen?(deps: Deps, action: AdminSkillFileInstallOpenAction): Promise<Result>;
  adminSkillInstallSubmit?(deps: Deps, action: AdminSkillInstallSubmitAction): Promise<Result>;
  adminSkillFileInstallSubmit?(deps: Deps, action: AdminSkillFileInstallSubmitAction): Promise<Result>;
  adminSkillFileInstallConfirm?(deps: Deps, action: AdminSkillFileInstallConfirmAction): Promise<Result>;
  adminSkillFileInstallCancel?(deps: Deps, action: AdminSkillFileInstallCancelAction): Promise<Result>;
  adminSkillBind?(deps: Deps, action: AdminSkillBindAction): Promise<Result>;
  adminSkillUnbind?(deps: Deps, action: AdminSkillUnbindAction): Promise<Result>;
  // Admin backend
  adminBackendEdit?(deps: Deps, action: AdminBackendEditAction): Promise<Result>;
  adminBackendPolicyEdit?(deps: Deps, action: AdminBackendPolicyEditAction): Promise<Result>;
  adminBackendPolicySave?(deps: Deps, action: AdminBackendPolicySaveAction): Promise<Result>;
  adminBackendAddProviderForm?(deps: Deps, action: AdminBackendAddProviderFormAction): Promise<Result>;
  adminBackendAddProvider?(deps: Deps, action: AdminBackendAddProviderAction): Promise<Result>;
  adminBackendRemoveProvider?(deps: Deps, action: AdminBackendRemoveProviderAction): Promise<Result>;
  adminBackendModelManage?(deps: Deps, action: AdminBackendModelManageAction): Promise<Result>;
  adminBackendValidateModel?(deps: Deps, action: AdminBackendValidateModelAction): Promise<Result>;
  adminBackendRemoveModel?(deps: Deps, action: AdminBackendRemoveModelAction): Promise<Result>;
  adminBackendRecheck?(deps: Deps, action: AdminBackendRecheckAction): Promise<Result>;
  adminBackendAddProfile?(deps: Deps, action: AdminBackendAddProfileAction): Promise<Result>;
  adminBackendRemoveProfile?(deps: Deps, action: AdminBackendRemoveProfileAction): Promise<Result>;
  raw?(deps: Deps, action: PlatformRawAction): Promise<Result>;
}

export class PlatformActionRouter<Deps, Result = unknown> {
  constructor(private readonly executor: PlatformActionExecutor<Deps, Result>) {}

  async route(deps: Deps, action: PlatformAction): Promise<Result | undefined> {
    switch (action.kind) {
      case "approval_decision":
        return this.executor.approvalDecision?.(deps, action);
      case "help_skill_install":
        return this.executor.helpSkillInstall?.(deps, action);
      case "help_skill_remove":
        return this.executor.helpSkillRemove?.(deps, action);
      case "admin_panel":
        return this.executor.adminPanel?.(deps, action);
      case "admin_user_page":
        return this.executor.adminUserPage?.(deps, action);
      case "user_input_reply":
        return this.executor.userInputReply?.(deps, action);
      case "thread_create":
        return this.executor.threadCreate?.(deps, action);
      case "thread_join":
        return this.executor.threadJoin?.(deps, action);
      case "thread_leave":
        return this.executor.threadLeave?.(deps, action);
      case "turn_interrupt":
        return this.executor.interruptTurn?.(deps, action);
      case "turn_accept":
        return this.executor.acceptTurn?.(deps, action);
      case "turn_revert":
        return this.executor.revertTurn?.(deps, action);
      case "merge_confirm":
        return this.executor.mergeConfirm?.(deps, action);
      case "merge_cancel":
        return this.executor.mergeCancel?.(deps, action);
      case "merge_review_cancel":
        return this.executor.mergeReviewCancel?.(deps, action);
      case "merge_review_start":
        return this.executor.mergeReviewStart?.(deps, action);
      case "merge_preview":
        return this.executor.mergePreview?.(deps, action);
      case "merge_retry_file":
        return this.executor.mergeRetryFile?.(deps, action);
      case "merge_review_open_file_detail":
        return this.executor.mergeReviewOpenFileDetail?.(deps, action);
      case "merge_review_back_overview":
        return this.executor.mergeReviewBackOverview?.(deps, action);
      case "merge_review_agent_assist_form":
        return this.executor.mergeReviewAgentAssistForm?.(deps, action);
      case "turn_view_file_changes":
        return this.executor.turnViewFileChanges?.(deps, action);
      case "turn_file_changes_back":
        return this.executor.turnFileChangesBack?.(deps, action);
      case "turn_view_tool_progress":
        return this.executor.turnViewToolProgress?.(deps, action);
      case "turn_tool_progress_back":
        return this.executor.turnToolProgressBack?.(deps, action);
      case "turn_view_detail":
        return this.executor.turnViewDetail?.(deps, action);
      case "snapshot_jump":
        return this.executor.snapshotJump?.(deps, action);
      case "merge_file_decision":
        return this.executor.mergeFileDecision?.(deps, action);
      case "merge_accept_all":
        return this.executor.mergeAcceptAll?.(deps, action);
      case "merge_agent_assist":
        return this.executor.mergeAgentAssist?.(deps, action);
      case "merge_batch_retry":
        return this.executor.mergeBatchRetry?.(deps, action);
      case "merge_commit":
        return this.executor.mergeCommit?.(deps, action);
      case "keep_merged_thread":
        return this.executor.keepMergedThread?.(deps, action);
      case "delete_merged_thread":
        return this.executor.deleteMergedThread?.(deps, action);
      case "admin_user_toggle":
        return this.executor.adminUserToggle?.(deps, action);
      case "help_panel":
        return this.executor.helpPanel?.(deps, action);
      case "help_project_push":
        return this.executor.helpProjectPush?.(deps, action);
      case "help_thread_new":
        return this.executor.helpThreadNew?.(deps, action);
      // Project init / bind
      case "init_project":
        return this.executor.initProject?.(deps, action);
      case "init_project_file_open":
        return this.executor.initProjectFileOpen?.(deps, action);
      case "init_project_file_save":
        return this.executor.initProjectFileSave?.(deps, action);
      case "init_project_file_reset_template":
        return this.executor.initProjectFileResetTemplate?.(deps, action);
      case "init_root_menu":
        return this.executor.initRootMenu?.(deps, action);
      case "init_bind_menu":
        return this.executor.initBindMenu?.(deps, action);
      case "init_create_menu":
        return this.executor.initCreateMenu?.(deps, action);
      case "init_bind_existing":
        return this.executor.initBindExisting?.(deps, action);
      case "install_skill":
        return this.executor.installSkill?.(deps, action);
      // Admin project
      case "admin_project_edit":
        return this.executor.adminProjectEdit?.(deps, action);
      case "admin_project_save":
        return this.executor.adminProjectSave?.(deps, action);
      case "admin_project_toggle":
        return this.executor.adminProjectToggle?.(deps, action);
      case "admin_project_unbind":
        return this.executor.adminProjectUnbind?.(deps, action);
      case "admin_project_delete":
        return this.executor.adminProjectDelete?.(deps, action);
      case "admin_project_members":
        return this.executor.adminProjectMembers?.(deps, action);
      case "admin_search_project":
        return this.executor.adminSearchProject?.(deps, action);
      case "admin_search_member":
        return this.executor.adminSearchMember?.(deps, action);
      case "admin_search_user":
        return this.executor.adminSearchUser?.(deps, action);
      // Admin member / role
      case "admin_member_role_change":
        return this.executor.adminMemberRoleChange?.(deps, action);
      case "help_role_change":
        return this.executor.helpRoleChange?.(deps, action);
      // Admin skill
      case "admin_skill_install_open":
        return this.executor.adminSkillInstallOpen?.(deps, action);
      case "admin_skill_file_install_open":
        return this.executor.adminSkillFileInstallOpen?.(deps, action);
      case "admin_skill_install_submit":
        return this.executor.adminSkillInstallSubmit?.(deps, action);
      case "admin_skill_file_install_submit":
        return this.executor.adminSkillFileInstallSubmit?.(deps, action);
      case "admin_skill_file_install_confirm":
        return this.executor.adminSkillFileInstallConfirm?.(deps, action);
      case "admin_skill_file_install_cancel":
        return this.executor.adminSkillFileInstallCancel?.(deps, action);
      case "admin_skill_bind":
        return this.executor.adminSkillBind?.(deps, action);
      case "admin_skill_unbind":
        return this.executor.adminSkillUnbind?.(deps, action);
      // Admin backend
      case "admin_backend_edit":
        return this.executor.adminBackendEdit?.(deps, action);
      case "admin_backend_policy_edit":
        return this.executor.adminBackendPolicyEdit?.(deps, action);
      case "admin_backend_policy_save":
        return this.executor.adminBackendPolicySave?.(deps, action);
      case "admin_backend_add_provider_form":
        return this.executor.adminBackendAddProviderForm?.(deps, action);
      case "admin_backend_add_provider":
        return this.executor.adminBackendAddProvider?.(deps, action);
      case "admin_backend_remove_provider":
        return this.executor.adminBackendRemoveProvider?.(deps, action);
      case "admin_backend_model_manage":
        return this.executor.adminBackendModelManage?.(deps, action);
      case "admin_backend_validate_model":
        return this.executor.adminBackendValidateModel?.(deps, action);
      case "admin_backend_remove_model":
        return this.executor.adminBackendRemoveModel?.(deps, action);
      case "admin_backend_recheck":
        return this.executor.adminBackendRecheck?.(deps, action);
      case "admin_backend_add_profile":
        return this.executor.adminBackendAddProfile?.(deps, action);
      case "admin_backend_remove_profile":
        return this.executor.adminBackendRemoveProfile?.(deps, action);
      case "raw":
        return this.executor.raw?.(deps, action);
      default:
        return undefined;
    }
  }
}
