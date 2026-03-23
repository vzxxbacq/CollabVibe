import { DEFAULT_APP_LOCALE, type AppLocale } from "../../../services/contracts/im/app-locale";

export interface FeishuCardBuilderStrings {
  threadCurrentReadonly: string;
  threadCurrent: string;
  threadCreating: string;
  threadCreatingDetail(backendName?: string, modelName?: string): string;
  threadSwitch: string;
  threadMainDescription: string;
  threadListTitle: string;
  threadListSubtitle(displayName?: string): string;
  threadListCount(count: number): string;
  snapshotNoSummary: string;
  snapshotJump: string;
  snapshotFiles(count: number): string;
  snapshotBackToHelp: string;
  snapshotMainTitle: string;
  snapshotThreadTitle(name: string): string;
  snapshotMainSubtitle: string;
  snapshotThreadSubtitle: string;
  snapshotVersionCount(count: number): string;
  threadCreatedTitle: string;
  threadCreatedName: string;
  threadCreatedId: string;
  threadCreatedBackend: string;
  threadCreatedModel: string;
  threadCreatedHint: string;
  threadNameLabel: string;
  threadNamePlaceholder: string;
  threadNameHint: string;
  backendModelLabel: string;
  backendModelPlaceholder: string;
  createThread: string;
  helpThreadNewTitle: string;
  helpThreadNewSubtitle: string;
  currentModelTag: string;
  modelSwitch: string;
  modelListTitle(threadName?: string): string;
  modelListSubtitle(currentModel: string): string;
  helpThreadMainDescription: string;
  helpThreadNewHover: string;
  helpThreadNewEntry: string;
  helpThreadNewEntryHint: string;
  helpThreadBack: string;
  helpThreadTitle: string;
  helpThreadSubtitle(displayName?: string): string;
  turnHistoryEmpty: string;
  turnHistoryDefaultSummary: string;
  turnHistoryBack: string;
  turnHistoryTitle: string;
  turnHistorySubtitle(count: number): string;
  initBindExisting(count: number): string;
  initCreateNew: string;
  initTitle: string;
  initSubtitle: string;
  initTagInit: string;
  initTagPending: string;
  initIntro: string;
  initBack: string;
  initBindHint: string;
  initNoUnbound: string;
  initBindToCurrentChat: string;
  initBindTitle: string;
  initBindSubtitle: string;
  initBindTag: string;
  initCreateFields: Array<{ label: string; placeholder: string; hint?: string }>;
  initCreateSubmit: string;
  initCreateTitle: string;
  initCreateSubtitle: string;
  initCreateTag: string;
  projectResumedProject: string;
  projectResumedId: string;
  projectResumedDir: string;
  projectResumedRepo: string;
  projectResumedLocalGit: string;
  projectResumedHint: string;
  projectResumedTitle: string;
  projectResumedSubtitle(name: string): string;
  initSuccessName: string;
  initSuccessId: string;
  initSuccessDir: string;
  initSuccessRepo: string;
  initSuccessBranch: string;
  initSuccessOwner: string;
  initSuccessLocalGit: string;
  initSuccessHint: string;
  initSuccessTitle: string;
  helpMergeOnMain: string;
  helpMergeGoThreads: string;
  helpMergeCurrentBranch(name: string): string;
  helpMergePreview(name: string): string;
  helpMergeBack: string;
  helpMergeTitle: string;
  helpMergeSubtitle(name?: string): string;
  helpSkillEmpty: string;
  helpSkillInstalled: string;
  helpSkillNotInstalled: string;
  helpSkillRemove: string;
  helpSkillRemoveConfirmTitle(name: string): string;
  helpSkillRemoveConfirmText: string;
  helpSkillInstall: string;
  helpSkillNoDescription: string;
  helpSkillBack: string;
  helpSkillTitle: string;
  helpSkillSubtitle(installed: number, total: number): string;
  helpBackendEmpty: string;
  helpBackendNoModels: string;
  helpBackendHint: string;
  helpBackendBack: string;
  helpBackendTitle: string;
  helpBackendSubtitle(count: number): string;
  adminPanels: Array<{ label: string; desc: string }>;
  adminPrivateOnly: string;
  adminHelpTitle: string;
  adminHelpSubtitle: string;
  adminProjectSearchPlaceholder: string;
  adminProjectEmpty(searchKeyword?: string): string;
  adminProjectEdit: string;
  adminProjectDisable: string;
  adminProjectEnable: string;
  adminProjectUnbind: string;
  adminProjectUnbindConfirmTitle(name: string): string;
  adminProjectUnbindConfirmText: string;
  adminProjectDelete: string;
  adminProjectDeleteConfirmTitle(name: string): string;
  adminProjectDeleteConfirmText: string;
  adminProjectMemberCount(count: number): string;
  adminProjectBack: string;
  adminProjectTitle: string;
  adminProjectSubtitle(searchKeyword?: string): string;
  adminProjectCount(count: number): string;
  localGitLabel: string;
  adminMemberSearchPlaceholder: string;
  adminMemberEmpty(searchKeyword?: string): string;
  adminMemberProjectLine(name: string, count: number): string;
  adminMemberNoMembers: string;
  adminMemberSelectRole: string;
  adminMemberHint: string;
  adminMemberBack: string;
  adminMemberTitle: string;
  adminMemberSubtitle(searchKeyword?: string): string;
  adminMemberCount(count: number): string;
  adminSkillNoDescription: string;
  adminSkillGithubInstall: string;
  adminSkillFeishuInstall: string;
  adminSkillRefresh: string;
  adminSkillCurrentProject(name?: string): string;
  adminSkillDownloaded(count: number): string;
  adminSkillEnabled(count: number): string;
  adminSkillEmpty: string;
  adminSkillPendingDownload: string;
  adminSkillDisable: string;
  adminSkillEnable: string;
  adminSkillUnboundHint: string;
  adminSkillViewFullDescription: string;
  adminSkillBack: string;
  adminSkillTitle: string;
  adminSkillSubtitle(name?: string): string;
  adminSkillCount(count: number): string;
  adminBackendEmpty: string;
  adminBackendProfileCount(count: number): string;
  adminBackendNoModels: string;
  adminBackendProviderCount(count: number, modelInfo: string, installHint: string): string;
  adminBackendBack: string;
  adminBackendTitle: string;
  adminBackendSubtitle: string;
  adminBackendCount(count: number): string;
  adminSkillInstallTitle: string;
  adminSkillInstallSubtitle: string;
  adminSkillInstallHint: string;
  adminSkillInstallSourcePlaceholder: string;
  adminSkillInstallSubpathPlaceholder: string;
  adminSkillInstallNamePlaceholder: string;
  adminSkillInstallActionPlaceholder: string;
  adminSkillInstallCatalogOnly: string;
  adminSkillInstallToProject: string;
  adminSkillInstallStart: string;
  adminSkillInstallBack: string;
  adminSkillFileTitle: string;
  adminSkillFileActionPlaceholder: string;
  adminSkillFileBack: string;
  adminSkillFileConfirmTitle: string;
  adminSkillFileConfirmSubtitle: string;
  adminSkillFileConfirmExpires(hint: string): string;
  adminSkillFileConfirmValidation(error: string): string;
  adminSkillFileLabelFile(name: string): string;
  adminSkillFileLabelSource(name: string): string;
  adminSkillFileLabelArchive(name: string): string;
  adminSkillFileLabelManifest(name: string): string;
  adminSkillFileLabelManifestFallback: string;
  adminSkillFileLabelManifestDescription(name: string): string;
  adminSkillFileLabelPostAction(text: string): string;
  adminSkillFilePostAction(projectName?: string): string;
  adminSkillFileCatalogOnly: string;
  adminSkillFileFinalNamePlaceholder: string;
  adminSkillFileConfirmInstall: string;
  adminSkillFileCancel: string;
  adminBackendEditMissingProvider: string;
  adminBackendRemoveProvider: string;
  adminBackendRemoveProviderConfirmTitle(name: string): string;
  adminBackendRemoveProviderConfirmText: string;
  adminBackendAvailable: string;
  adminBackendUnavailable: string;
  adminBackendChecking: string;
  adminBackendNoModelsConfigured: string;
  adminBackendRunPolicy: string;
  adminBackendAddProvider: string;
  adminBackendModelManage(count: number): string;
  adminBackendBackToConfig(name: string): string;
  adminBackendEditSubtitle(name: string): string;
  adminBackendProviderCountOnly(count: number): string;
  adminBackendDelete: string;
  adminBackendDeleteModelConfirmTitle(name: string): string;
  adminBackendDeleteModelConfirmText: string;
  adminBackendProviderLabel: string;
  adminBackendChooseProvider: string;
  adminBackendNoProvider: string;
  adminBackendModelName: string;
  adminBackendModelPlaceholder: string;
  adminBackendProfileName: string;
  adminBackendProfilePlaceholder: string;
  adminBackendReasoningEffort: string;
  adminBackendChooseReasoning: string;
  adminBackendPersonality: string;
  adminBackendChoosePersonality: string;
  adminBackendThinkingBudget: string;
  adminBackendThinkingBudgetPlaceholder: string;
  adminBackendContextLimit: string;
  adminBackendContextLimitPlaceholder: string;
  adminBackendOutputLimit: string;
  adminBackendOutputLimitPlaceholder: string;
  adminBackendInputModalities: string;
  adminBackendChooseInputModalities: string;
  adminBackendOutputModalities: string;
  adminBackendChooseOutputModalities: string;
  adminBackendNewModel: string;
  adminBackendModelCardTitle(name: string): string;
  adminBackendModelCardSubtitle: string;
  adminBackendPolicyTitle: string;
  adminBackendPolicySubtitle(name: string): string;
  adminBackendSavePolicy: string;
  adminBackendBackToBackend(name: string): string;
  adminBackendAddProviderTitle: string;
  adminBackendAddProviderSubtitle(name: string): string;
  adminBackendProviderName: string;
  adminBackendProviderNamePlaceholder: string;
  adminBackendBaseUrl: string;
  adminBackendBaseUrlPlaceholder: string;
  adminBackendApiKey(labelCodex: boolean): string;
  adminBackendApiKeyPlaceholder(labelCodex: boolean): string;
  adminBackendAddProviderSubmit: string;
  mergeReviewTitle(index: number, total: number): string;
  mergeReviewViewDiff: string;
  mergeReviewRejectHint: string;
  mergeReviewFeedbackLabel: string;
  mergeReviewFeedbackPlaceholder: string;
  mergeReviewRejectAction: string;
  mergeReviewOverviewTitle: string;
  mergeReviewOverview(decided: number, total: number, pendingConflicts: number, pendingDirect: number, agentPending: number): string;
  mergeReviewQueueConflict(count: number, list: string): string;
  mergeReviewQueueDirect(count: number, list: string): string;
  mergeReviewQueueAgentPending(count: number, list: string): string;
  mergeReviewRecoveryRequiredTitle: string;
  mergeReviewRecoveryRequiredBody(reason: string): string;
  mergeReviewRecoveryRollback: string;
  mergeReviewOpenFile: string;
  mergeReviewNoPendingFiles: string;
  mergeReviewAgentAssist: string;
  mergeReviewAgentAssistSubtitle(branchName: string, count: number): string;
  mergeReviewAgentAssistWarning: string;
  mergeReviewAgentAssistPromptLabel: string;
  mergeReviewAgentAssistPromptPlaceholder: string;
  mergeReviewAgentAssistConfirm: string;
  mergeReviewAgentAssistBack: string;
  mergeReviewCurrentFileTitle: string;
  mergeReviewFileActionsTitle: string;
  mergeReviewSessionActionsTitle: string;
  mergeReviewAutoMergedHint: string;
  mergeReviewAgentResolvedHint: string;
  mergeReviewConflictHint: string;
  mergeReviewAddedHint: string;
  mergeReviewDeletedHint: string;
  mergeReviewBatchAcceptHint: string;
  mergeReviewBatchResolveConflicts(count: number): string;
  mergeReviewResolvingConflicts(count: number): string;
  mergeReviewAcceptAll(remaining: number): string;
  mergeReviewProgress(accepted: number, rejected: number, remaining: number, pct: number): string;
  mergeSummaryAccepted(count: number, list: string): string;
  mergeSummaryKeepMain(count: number, list: string): string;
  mergeSummaryUseBranch(count: number, list: string): string;
  mergeSummarySkipped(count: number, list: string): string;
  mergeSummaryPartialWarning: string;
  mergeSummaryCommit: string;
  mergeSummaryCancel: string;
  searchButton: string;
  mergePreviewChanged(count: number, additions: number, deletions: number): string;
  mergePreviewNoChanges: string;
  mergeConflictResolverTag: string;
  mergeConflictResolverHelp(threadName?: string): string;
  mergeForceHint: string;
  mergeConflictCount(count: number): string;
  mergeNoChangesCleanupHint: string;
  mergeNoChangesTitle: string;
  mergeCleanupWorktree: string;
  mergeDeleteBranch: string;
  mergeReviewCancelConfirmTitle: string;
  mergeReviewCancelConfirmText: string;
  mergeBatchRetrySelectLabel: string;
  mergeBatchRetryFeedbackLabel: string;
  mergeBatchRetryFeedbackPlaceholder: string;
  mergeBatchRetrySubmit: string;
  mergeDiffBaseline(baseBranch: string): string;
  mergeConfirm: string;
  mergeBack: string;
  mergeConflictDetail(hasResolverThread: boolean): string;
  mergeStartReview(hasResolverThread: boolean): string;
  mergeCanMerge: string;
  mergeHasConflict: string;
  mergePreviewSubtitle: string;
  mergeMergedFiles(count: number, additions: number, deletions: number, fileList: string): string;
  mergeResultSuccess: string;
  mergeResultFailed: string;
  mergeResultSuccessSubtitle: string;
  mergeResultFailedSubtitle: string;
  mergeKeepThread: string;
  mergeDeleteThread: string;
  mergeKeepThreadSuccessSubtitle: string;
  mergeDeleteThreadSuccessSubtitle: string;
  mergeBackToThreads: string;
  helpNoMembers: string;
  helpMemberUser: string;
  helpMemberRole: string;
  helpSelectRole: string;
  helpMemberManagement: string;
  helpPromptTip: string;
  helpOpenPanelTip: string;
  helpTitle(projectName?: string): string;
  helpSubtitle: string;
  adminProjectNameLabel: string;
  adminProjectNamePlaceholder: string;
  adminProjectGitUrlLabel: string;
  adminProjectChatBindingLabel: string;
  adminProjectCurrentBinding(chatId: string): string;
  adminProjectNoBinding: string;
  adminProjectUnbindChat: string;
  adminProjectUnbindChatConfirmTitle: string;
  adminProjectUnbindChatConfirmText: string;
  save: string;
  adminProjectEditTitle: string;
  adminProjectEditBack: string;
  adminUserSearchPlaceholder: string;
  adminUserEmpty(searchKeyword?: string): string;
  adminUserSourceLockedEnv: string;
  adminUserSourceFeishu: string;
  adminUserLocked: string;
  adminUserDemote: string;
  adminUserDemoteConfirmTitle(name: string): string;
  adminUserDemoteConfirmText: string;
  adminUserPromote: string;
  previousPage: string;
  nextPage: string;
  adminConsoleBack: string;
  adminUserSubtitle(searchKeyword?: string): string;
  adminUserTitle: string;
  adminUserCount(count: number): string;
  adminSkillFileIdleSubtitle: string;
  adminSkillFileIdleHint: string;
  adminSkillFileIdleButton: string;
  adminSkillFileWaitingSubtitle: string;
  adminSkillFileWaitingHint: string;
  adminSkillFileWaitingButton: string;
  mergeDecisionAccept: string;
  mergeDecisionKeepMain: string;
  mergeDecisionUseBranch: string;
  mergeDecisionSkip: string;
  mergeStatusAutoMerged: string;
  mergeStatusAgentResolved: string;
  mergeStatusAgentPending: string;
  mergeStatusConflict: string;
  mergeStatusAdded: string;
  mergeStatusDeleted: string;
  mergeDiffTruncated: string;
  mergeDecisionKeepMainLabel: string;
  mergeDecisionUseBranchLabel: string;
  mergeDecisionSkipLabel: string;
  mergeSummaryTitle: string;
  mergeSummarySubtitle(branchName: string, baseBranch: string, decided: number, total: number): string;
  pluginSourceGithubSubpath: string;
  pluginSourceFeishuUpload: string;
  adminSkillTagDownloaded: string;
  adminSkillTagNotDownloaded: string;
  adminSkillTagEnabled: string;
  adminSkillTagNotEnabled: string;
  adminSkillTagHasMcp: string;
  adminSkillDownloadedAt(text: string): string;
  adminBackendReasoningHigh: string;
  adminBackendReasoningMedium: string;
  adminBackendReasoningLow: string;
  adminBackendPersonalityFriendly: string;
  adminBackendPersonalityPragmatic: string;
  adminBackendPersonalityNone: string;
  adminBackendPolicyApproval: string;
  adminBackendPolicyApprovalOnRequest: string;
  adminBackendPolicyApprovalNever: string;
  adminBackendPolicyApprovalUntrusted: string;
  adminBackendPolicySandbox: string;
  adminBackendPolicySandboxWorkspaceWrite: string;
  adminBackendPolicySandboxReadOnly: string;
  adminBackendPolicySandboxFullAccess: string;
  adminBackendPolicyQuestion: string;
  adminBackendPolicyQuestionAllow: string;
  adminBackendPolicyQuestionAsk: string;
  adminBackendPolicyQuestionDeny: string;
  turnHistoryAccepted: string;
  turnHistoryReverted: string;
  turnHistoryInterrupted: string;
  turnHistoryCompleted: string;
  helpPanelThreads: string;
  helpPanelThreadsDesc: string;
  helpPanelMerge: string;
  helpPanelMergeDesc: string;
  helpPanelHistory: string;
  helpPanelHistoryDesc: string;
  helpPanelTurns: string;
  helpPanelTurnsDesc: string;
  helpPanelSkills: string;
  helpPanelSkillsDesc: string;
  helpPanelBackends: string;
  helpPanelBackendsDesc: string;
  helpPanelProject: string;
  helpPanelProjectDesc: string;
  helpProjectTitle: string;
  helpProjectSubtitle(name: string): string;
  helpProjectPathLabel: string;
  helpProjectIdLabel: string;
  helpProjectGitUrlLabel: string;
  helpProjectGitUrlPlaceholder: string;
  helpProjectWorkBranchLabel: string;
  helpProjectWorkBranchPlaceholder: string;
  helpProjectGitignoreLabel: string;
  helpProjectGitignorePlaceholder: string;
  helpProjectAgentsMdLabel: string;
  helpProjectAgentsMdPlaceholder: string;
  helpProjectSave: string;
  helpProjectPush: string;
  helpProjectBack: string;
  helpProjectPushSuccess: string;
  helpProjectPushFailed(err: string): string;
  helpProjectSaveSuccess: string;
  helpProjectSaveFailed(err: string): string;
  helpThreadManageBack: string;
  adminSkillFileDefaultHint: string;
  adminSkillFileDefaultSource: string;
  adminSkillFileDefaultArchive: string;
  adminBackendInstallHint(text: string): string;
  adminBackendKeyConfigured: string;
  adminBackendKeyNotConfigured: string;
}

const zhCN: FeishuCardBuilderStrings = {
  threadCurrentReadonly: "<text_tag color='green'>当前</text_tag> **只读**",
  threadCurrent: "<text_tag color='green'>当前</text_tag>",
  threadCreating: "<text_tag color='orange'>创建中</text_tag>",
  threadCreatingDetail: (backendName, modelName) => {
    const backend = backendName ? ` · ${backendName}` : "";
    const model = modelName ? ` / ${modelName}` : "";
    return `⏳ 创建中${backend}${model}`;
  },
  threadSwitch: "切换",
  threadMainDescription: "**main** (主分支)\n🔒 受保护 · 仅通过 `/merge` 写入",
  threadListTitle: "Thread 列表",
  threadListSubtitle: (displayName) => displayName ? `${displayName} 的线程 · 点击切换` : "点击切换",
  threadListCount: (count) => `${count} 个`,
  snapshotNoSummary: "(无摘要)",
  snapshotJump: "跳转",
  snapshotFiles: (count) => `📝 ${count} 个文件`,
  snapshotBackToHelp: "返回命令帮助",
  snapshotMainTitle: "main · merge 历史",
  snapshotThreadTitle: (name) => `${name} · 快照历史`,
  snapshotMainSubtitle: "每次 /merge 自动记录快照",
  snapshotThreadSubtitle: "点击跳转到任意版本",
  snapshotVersionCount: (count) => `${count} 个版本`,
  threadCreatedTitle: "✅ Thread 创建成功",
  threadCreatedName: "🧵 **名称**",
  threadCreatedId: "🆔 **ID**",
  threadCreatedBackend: "⚙️ **后端**",
  threadCreatedModel: "🤖 **模型**",
  threadCreatedHint: "💡 现在可以直接 @bot 发送消息到这个 Thread",
  threadNameLabel: "Thread 名称",
  threadNamePlaceholder: "例如: feature-auth",
  threadNameHint: "仅允许字母、数字和 -，例如: feature-auth",
  backendModelLabel: "后端引擎 · 模型",
  backendModelPlaceholder: "选择后端和模型",
  createThread: "创建 Thread",
  helpThreadNewTitle: "新建 Thread",
  helpThreadNewSubtitle: "选择后端和模型，然后创建",
  currentModelTag: "🟢 **当前模型**",
  modelSwitch: "切换",
  modelListTitle: (threadName) => threadName ? `🤖 模型选择 · ${threadName}` : "🤖 模型选择",
  modelListSubtitle: (currentModel) => `当前: ${currentModel}`,
  helpThreadMainDescription: "**main** (主分支)\n🔒 受保护 · 仅通过合并写入",
  helpThreadNewHover: "选择后端和模型，创建新线程",
  helpThreadNewEntry: "**新建 Thread**",
  helpThreadNewEntryHint: "选择后端 · 模型 · 创建",
  helpThreadBack: "返回命令帮助",
  helpThreadTitle: "线程管理",
  helpThreadSubtitle: (displayName) => displayName ? `${displayName} 的线程 · 切换或新建` : "切换或新建线程",
  turnHistoryEmpty: "暂无 Turn 记录。发送消息后自动创建",
  turnHistoryDefaultSummary: "Turn 记录",
  turnHistoryBack: "返回命令帮助",
  turnHistoryTitle: "历史会话",
  turnHistorySubtitle: (count) => `${count} 条 Turn 记录`,
  initBindExisting: (count) => `**绑定已有项目**\n选择一个未绑定群聊的项目接入当前群（${count} 个可选）`,
  initCreateNew: "**新建项目**\n创建一个新的项目目录，并绑定到当前群聊",
  initTitle: "CollabVibe 项目初始化",
  initSubtitle: "请先选择操作：绑定已有项目，或新建项目",
  initTagInit: "初始化",
  initTagPending: "待选择",
  initIntro: "首次接入群聊时，请先从一级菜单中选择初始化方式。",
  initBack: "返回初始化菜单",
  initBindHint: "选择一个尚未绑定群聊的已有项目，直接绑定到当前群。",
  initNoUnbound: "暂无未绑定项目，请返回后选择“新建项目”。",
  initBindToCurrentChat: "绑定到当前群",
  initBindTitle: "CollabVibe 绑定已有项目",
  initBindSubtitle: "从未绑定的项目中选择一个接入当前群聊",
  initBindTag: "绑定已有",
  initCreateFields: [
    { label: "项目名称", placeholder: "例如: my-project" },
    { label: "工作目录", placeholder: "my-project", hint: "子目录名称，留空则使用项目名" },
    { label: "Git 仓库 URL", placeholder: "https://github.com/org/repo.git", hint: "可选，留空则 git init" },
    { label: "Clone Token", placeholder: "ghp_xxxx 或 PAT", hint: "可选，私有仓库使用" },
    { label: "工作分支", placeholder: "dev", hint: "可选，留空则使用 collabvibe/{项目名}" },
  ],
  initCreateSubmit: "创建项目",
  initCreateTitle: "CollabVibe 新建项目",
  initCreateSubtitle: "填写项目信息，并绑定到当前群聊",
  initCreateTag: "新建项目",
  projectResumedProject: "项目",
  projectResumedId: "ID",
  projectResumedDir: "目录",
  projectResumedRepo: "仓库",
  projectResumedLocalGit: "(本地 git)",
  projectResumedHint: "✅ 项目已恢复，可继续使用",
  projectResumedTitle: "项目已恢复",
  projectResumedSubtitle: (name) => `${name} · 重新绑定`,
  initSuccessName: "名称",
  initSuccessId: "ID",
  initSuccessDir: "目录",
  initSuccessRepo: "仓库",
  initSuccessBranch: "工作分支",
  initSuccessOwner: "Owner",
  initSuccessLocalGit: "(本地 git init)",
  initSuccessHint: "现在可以 @bot 直接对话",
  initSuccessTitle: "项目创建成功",
  helpMergeOnMain: "当前在 main 分支，请先切换到 thread 再执行合并。",
  helpMergeGoThreads: "**前往线程管理**",
  helpMergeCurrentBranch: (name) => `当前分支: **${name}**\n点击下方按钮预览合并结果`,
  helpMergePreview: (name) => `**预览合并 ${name} → main**`,
  helpMergeBack: "返回命令帮助",
  helpMergeTitle: "合并管理",
  helpMergeSubtitle: (name) => name ? `${name} → main` : "请先切换到分支",
  helpSkillEmpty: "暂无可用 Skill。请联系管理员通过管理控制台添加。",
  helpSkillInstalled: "<text_tag color='green'>已装</text_tag>",
  helpSkillNotInstalled: "<text_tag color='neutral'>未装</text_tag>",
  helpSkillRemove: "卸载",
  helpSkillRemoveConfirmTitle: (name) => `卸载 "${name}"？`,
  helpSkillRemoveConfirmText: "卸载后可重新安装。",
  helpSkillInstall: "安装",
  helpSkillNoDescription: "无描述",
  helpSkillBack: "返回命令帮助",
  helpSkillTitle: "技能管理",
  helpSkillSubtitle: (installed, total) => `${installed}/${total} 已安装`,
  helpBackendEmpty: "暂无可用后端。请联系管理员配置。",
  helpBackendNoModels: "无可用模型",
  helpBackendHint: "💡 创建新线程时可选择以上 Backend · Model 组合",
  helpBackendBack: "返回命令帮助",
  helpBackendTitle: "后端概览",
  helpBackendSubtitle: (count) => `${count} 个引擎`,
  adminPanels: [
    { label: "项目管理", desc: "项目/群聊/成员关系总览" },
    { label: "用户管理", desc: "系统用户 · 管理员权限" },
    { label: "成员管理", desc: "按项目管理成员角色" },
    { label: "Skill 管理", desc: "系统安装与项目启用" },
    { label: "后端配置", desc: "引擎、接入源与模型配置" },
  ],
  adminPrivateOnly: "🔒 仅限管理员私聊使用 · 群聊命令请在项目群中操作",
  adminHelpTitle: "管理员控制台",
  adminHelpSubtitle: "点击面板进入对应管理",
  adminProjectSearchPlaceholder: "输入项目名称搜索",
  adminProjectEmpty: (searchKeyword) => searchKeyword ? `未找到匹配 "${searchKeyword}" 的项目` : "暂无项目。在群聊中添加 bot 即可自动初始化项目。",
  adminProjectEdit: "编辑",
  adminProjectDisable: "禁用",
  adminProjectEnable: "启用",
  adminProjectUnbind: "解绑",
  adminProjectUnbindConfirmTitle: (name) => `解绑 "${name}"？`,
  adminProjectUnbindConfirmText: "Bot 将退出群聊，项目变为未绑定状态。可稍后重新绑定到其他群。",
  adminProjectDelete: "删除",
  adminProjectDeleteConfirmTitle: (name) => `删除项目 "${name}"？`,
  adminProjectDeleteConfirmText: "此操作不可逆。Bot 将退出群聊，项目和成员数据将被永久删除。",
  adminProjectMemberCount: (count) => `${count} 位成员`,
  adminProjectBack: "返回管理控制台",
  adminProjectTitle: "项目管理",
  adminProjectSubtitle: (searchKeyword) => searchKeyword ? `搜索: "${searchKeyword}"` : "项目/目录/成员 关系总览",
  adminProjectCount: (count) => `${count} 个项目`,
  localGitLabel: "本地 git",
  adminMemberSearchPlaceholder: "输入项目名称搜索",
  adminMemberEmpty: (searchKeyword) => searchKeyword ? `未找到匹配 "${searchKeyword}" 的项目` : "暂无项目。请在群聊中初始化项目。",
  adminMemberProjectLine: (name, count) => `**${name}** · ${count} 个成员`,
  adminMemberNoMembers: "暂无成员。用户加入群聊后自动注册为 auditor。",
  adminMemberSelectRole: "选择角色",
  adminMemberHint: "💡 新用户自动注册为 auditor，管理员通过下拉菜单提权",
  adminMemberBack: "返回管理控制台",
  adminMemberTitle: "项目成员管理",
  adminMemberSubtitle: (searchKeyword) => searchKeyword ? `搜索: "${searchKeyword}"` : "按项目管理成员角色",
  adminMemberCount: (count) => `${count} 成员`,
  adminSkillNoDescription: "无描述",
  adminSkillGithubInstall: "Github 安装",
  adminSkillFeishuInstall: "飞书文件安装",
  adminSkillRefresh: "刷新",
  adminSkillCurrentProject: (name) => `当前项目：${name ?? "未绑定"}`,
  adminSkillDownloaded: (count) => `已下载 ${count}`,
  adminSkillEnabled: (count) => `已启用 ${count}`,
  adminSkillEmpty: "暂无扩展。使用上方来源按钮开始安装。",
  adminSkillPendingDownload: "待下载",
  adminSkillDisable: "停用",
  adminSkillEnable: "启用",
  adminSkillUnboundHint: "未绑定项目：当前仅展示已下载扩展，暂不可启用/停用",
  adminSkillViewFullDescription: "查看完整介绍",
  adminSkillBack: "返回管理控制台",
  adminSkillTitle: "扩展管理",
  adminSkillSubtitle: (name) => name ? `${name} · 插件/Skill` : "插件/Skill 下载与启用",
  adminSkillCount: (count) => `${count} 个扩展`,
  adminBackendEmpty: "暂无后端引擎配置。",
  adminBackendProfileCount: (count) => `${count} 个模型`,
  adminBackendNoModels: "无模型",
  adminBackendProviderCount: (count, modelInfo, installHint) => `${count} 个接入源 · ${modelInfo}${installHint}`,
  adminBackendBack: "返回管理控制台",
  adminBackendTitle: "后端配置",
  adminBackendSubtitle: "引擎 · 接入源 · 模型",
  adminBackendCount: (count) => `${count} 引擎`,
  adminSkillInstallTitle: "来源 GitHub 安装",
  adminSkillInstallSubtitle: "当前仅支持 GitHub 仓库 + skill 子路径",
  adminSkillInstallHint: "管理员安装到系统 catalog；项目是否生效由 maintainer 在项目面板启用。MCP 只解析声明，不自动安装依赖。",
  adminSkillInstallSourcePlaceholder: "GitHub 仓库链接",
  adminSkillInstallSubpathPlaceholder: "skill 子路径，例如 .claude/skills/ui-ux-pro-max",
  adminSkillInstallNamePlaceholder: "安装名称（可选）",
  adminSkillInstallActionPlaceholder: "下载后动作",
  adminSkillInstallCatalogOnly: "仅下载到 catalog",
  adminSkillInstallToProject: "下载并启用到当前项目",
  adminSkillInstallStart: "开始安装",
  adminSkillInstallBack: "返回扩展管理",
  adminSkillFileTitle: "飞书文件安装",
  adminSkillFileActionPlaceholder: "下载后动作",
  adminSkillFileBack: "返回扩展管理",
  adminSkillFileConfirmTitle: "确认安装 Skill 文件",
  adminSkillFileConfirmSubtitle: "文件已上传到服务器临时目录，确认后才会正式安装",
  adminSkillFileConfirmExpires: (hint) => `**⚠️ 请在 ${hint}确认安装，否则系统会自动取消并删除临时文件。**`,
  adminSkillFileConfirmValidation: (error) => `**名称校验失败：** ${error}`,
  adminSkillFileLabelFile: (name) => `文件：${name}`,
  adminSkillFileLabelSource: (name) => `来源：${name}`,
  adminSkillFileLabelArchive: (name) => `压缩包格式：${name}`,
  adminSkillFileLabelManifest: (name) => `Manifest 名称：${name}`,
  adminSkillFileLabelManifestFallback: "未声明；已回退到管理员输入或文件名",
  adminSkillFileLabelManifestDescription: (name) => `Manifest 描述：${name}`,
  adminSkillFileLabelPostAction: (text) => `下载后动作：${text}`,
  adminSkillFilePostAction: (projectName) => `下载并启用到当前项目${projectName ? `（${projectName}）` : ""}`,
  adminSkillFileCatalogOnly: "仅下载到 catalog",
  adminSkillFileFinalNamePlaceholder: "最终 Skill 名称",
  adminSkillFileConfirmInstall: "确认安装",
  adminSkillFileCancel: "取消",
  adminBackendEditMissingProvider: "暂无模型",
  adminBackendRemoveProvider: "删除接入源",
  adminBackendRemoveProviderConfirmTitle: (name) => `删除接入源 "${name}"？`,
  adminBackendRemoveProviderConfirmText: "将同时删除该接入源下所有模型，此操作不可撤销。",
  adminBackendAvailable: "<font color='green'>可用</font>",
  adminBackendUnavailable: "<font color='red'>不可用</font>",
  adminBackendChecking: "<font color='grey'>检测中</font>",
  adminBackendNoModelsConfigured: "暂无模型",
  adminBackendRunPolicy: "运行策略",
  adminBackendAddProvider: "添加接入源",
  adminBackendModelManage: (count) => `模型管理 · ${count} 个模型`,
  adminBackendBackToConfig: (name) => `返回 ${name} 配置`,
  adminBackendEditSubtitle: (name) => `后端配置 › ${name}`,
  adminBackendProviderCountOnly: (count) => `${count} 个接入源`,
  adminBackendDelete: "删除",
  adminBackendDeleteModelConfirmTitle: (name) => `删除模型 "${name}"？`,
  adminBackendDeleteModelConfirmText: "删除后需重新添加，确认继续？",
  adminBackendProviderLabel: "接入源",
  adminBackendChooseProvider: "选择接入源",
  adminBackendNoProvider: "无接入源",
  adminBackendModelName: "模型名",
  adminBackendModelPlaceholder: "如 gpt-5.3-codex",
  adminBackendProfileName: "预设名称",
  adminBackendProfilePlaceholder: "如 5.3-codex-high",
  adminBackendReasoningEffort: "Reasoning Effort — 推理力度",
  adminBackendChooseReasoning: "选择推理力度",
  adminBackendPersonality: "Personality — 沟通风格",
  adminBackendChoosePersonality: "选择风格",
  adminBackendThinkingBudget: "Thinking Budget Tokens — 思考预算",
  adminBackendThinkingBudgetPlaceholder: "例如: 8192",
  adminBackendContextLimit: "Context Limit — 上下文限制",
  adminBackendContextLimitPlaceholder: "例如: 202752",
  adminBackendOutputLimit: "Output Limit — 输出限制",
  adminBackendOutputLimitPlaceholder: "例如: 16384",
  adminBackendInputModalities: "Input Modalities — 输入类型",
  adminBackendChooseInputModalities: "选择输入类型",
  adminBackendOutputModalities: "Output Modalities — 输出类型",
  adminBackendChooseOutputModalities: "选择输出类型",
  adminBackendNewModel: "新建模型",
  adminBackendModelCardTitle: (name) => `${name} › 新建模型`,
  adminBackendModelCardSubtitle: "每个预设 = 模型 + 后端参数，创建 Thread 时选择预设即可",
  adminBackendPolicyTitle: "运行策略",
  adminBackendPolicySubtitle: (name) => `后端配置 › ${name} › 运行策略`,
  adminBackendSavePolicy: "保存策略",
  adminBackendBackToBackend: (name) => `返回 ${name}`,
  adminBackendAddProviderTitle: "添加接入源",
  adminBackendAddProviderSubtitle: (name) => `后端配置 › ${name} › 添加接入源`,
  adminBackendProviderName: "接入源名称",
  adminBackendProviderNamePlaceholder: "接入源名称",
  adminBackendBaseUrl: "Base URL",
  adminBackendBaseUrlPlaceholder: "Base URL",
  adminBackendApiKey: (labelCodex) => labelCodex ? "API Key" : "API Key / 环境变量名",
  adminBackendApiKeyPlaceholder: (labelCodex) => labelCodex ? "sk-xxx" : "API Key 或环境变量名 (如 MY_API_KEY)",
  adminBackendAddProviderSubmit: "添加接入源",
  mergeReviewTitle: (index, total) => `合并审阅 (${index}/${total})`,
  mergeReviewViewDiff: "查看 Diff",
  mergeReviewRejectHint: "系统会自动附带默认英文 merge prompt 和当前文件内容摘录；这里填写的是额外补充要求。",
  mergeReviewFeedbackLabel: "补充说明 (可选，发送给 Agent)",
  mergeReviewFeedbackPlaceholder: "例: 保留输入校验，并保留 CLI 入口",
  mergeReviewRejectAction: "拒绝并反馈 Agent",
  mergeReviewOverviewTitle: "**处理概览**",
  mergeReviewOverview: (decided, total, pendingConflicts, pendingDirect, agentPending) => `已决策 ${decided}/${total} · 待处理冲突 ${pendingConflicts} · 待确认结果 ${pendingDirect} · Agent 处理中 ${agentPending}`,
  mergeReviewQueueConflict: (count, list) => `**待处理冲突 (${count})**\n${list}`,
  mergeReviewQueueDirect: (count, list) => `**待确认结果 (${count})**\n${list}`,
  mergeReviewQueueAgentPending: (count, list) => `**Agent 批量处理中 (${count})**\n${list}`,
  mergeReviewRecoveryRequiredTitle: "**需要恢复**",
  mergeReviewRecoveryRequiredBody: (reason) => `当前 merge session 与 git 现场不一致，不能继续审阅。\n原因: ${reason}`,
  mergeReviewRecoveryRollback: "回滚并清理本次 merge",
  mergeReviewOpenFile: "逐个文件查看",
  mergeReviewNoPendingFiles: "当前没有待处理文件",
  mergeReviewAgentAssist: "Agent 协助",
  mergeReviewAgentAssistSubtitle: (branchName, count) => `${branchName} · 剩余 ${count} 个冲突文件`,
  mergeReviewAgentAssistWarning: "确认后，Agent 将接管当前仍未决的冲突文件。已由 Agent 修改过的文件不能再切回手动选择基线或分支。",
  mergeReviewAgentAssistPromptLabel: "补充要求 (可选)",
  mergeReviewAgentAssistPromptPlaceholder: "例: 优先保留 API 兼容性，不要删除现有校验",
  mergeReviewAgentAssistConfirm: "确认交给 Agent",
  mergeReviewAgentAssistBack: "返回审阅总览",
  mergeReviewCurrentFileTitle: "**当前处理文件**",
  mergeReviewFileActionsTitle: "**当前文件**",
  mergeReviewSessionActionsTitle: "**整场审阅**",
  mergeReviewAutoMergedHint: "系统已自动生成该文件的合并结果。请确认是否接受当前结果，或改为保留基线/使用分支。",
  mergeReviewAgentResolvedHint: "Agent 已生成当前结果。你可以直接接受，或补充说明后要求 Agent 重试。",
  mergeReviewConflictHint: "该文件仍有冲突，必须先选择保留基线或使用分支版本。",
  mergeReviewAddedHint: "这是分支新增文件。接受当前结果会把它带入本次合并；跳过则不合入该文件。",
  mergeReviewDeletedHint: "这是一次删除变更。接受当前结果会删除该文件；保留基线则继续保留它。",
  mergeReviewBatchAcceptHint: "该操作只会通过剩余的非冲突文件，不会替你决定冲突文件。",
  mergeReviewBatchResolveConflicts: (count) => `**让 Agent 批量处理剩余冲突** (${count} 个冲突)`,
  mergeReviewResolvingConflicts: (count) => `Agent 正在批量处理剩余 **${count}** 个冲突文件。处理完成后会自动回到审阅总览。`,
  mergeReviewAcceptAll: (remaining) => `**批量接受其余可直接通过文件** (剩余 ${remaining} 个文件)`,
  mergeReviewProgress: (accepted, rejected, remaining, pct) => `进度: 已接受 ${accepted} · 已拒绝 ${rejected} · 待处理 ${remaining} (${pct}%)`,
  mergeSummaryAccepted: (count, list) => `**接受当前结果 (${count})**\n${list}`,
  mergeSummaryKeepMain: (count, list) => `**保留基线 (${count})**\n${list}`,
  mergeSummaryUseBranch: (count, list) => `**使用分支 (${count})**\n${list}`,
  mergeSummarySkipped: (count, list) => `**跳过 (${count})**\n${list}`,
  mergeSummaryPartialWarning: "部分文件未采用当前合并结果；执行合并前请确认这是你的预期。",
  mergeSummaryCommit: "执行合并",
  mergeSummaryCancel: "取消本次合并审阅",
  helpNoMembers: "暂无成员",
  helpMemberUser: "**用户**",
  helpMemberRole: "**角色**",
  helpSelectRole: "选择角色",
  helpMemberManagement: "**成员管理**",
  helpPromptTip: "💡 @bot + 自然语言 = Prompt 交互，无需命令",
  helpOpenPanelTip: "💡 呼出面板：群里 @bot 直接发送空消息，即可再次打开本卡片",
  helpTitle: (projectName) => projectName ? `${projectName} · 命令帮助` : "项目命令帮助",
  helpSubtitle: "点击进入对应面板 · @bot 发送自然语言",
  adminProjectNameLabel: "**项目名称**",
  adminProjectNamePlaceholder: "项目名称",
  adminProjectGitUrlLabel: "**Git 仓库 URL**",
  adminProjectChatBindingLabel: "**群聊绑定**",
  adminProjectCurrentBinding: (chatId) => `当前绑定: ${chatId}`,
  adminProjectNoBinding: "当前未绑定群聊",
  adminProjectUnbindChat: "解绑群聊",
  adminProjectUnbindChatConfirmTitle: "解绑群聊？",
  adminProjectUnbindChatConfirmText: "Bot 将退出群聊，项目变为未绑定状态。",
  save: "保存",
  adminProjectEditTitle: "编辑项目",
  adminProjectEditBack: "返回项目管理",
  adminUserSearchPlaceholder: "输入用户名搜索",
  adminUserEmpty: (searchKeyword) => searchKeyword ? `未找到匹配 "${searchKeyword}" 的用户` : "暂无注册用户",
  adminUserSourceLockedEnv: "env · 锁定",
  adminUserSourceFeishu: "飞书",
  adminUserLocked: "锁定",
  adminUserDemote: "降级",
  adminUserDemoteConfirmTitle: (name) => `降级 "${name}"？`,
  adminUserDemoteConfirmText: "该用户将失去管理员权限。",
  adminUserPromote: "提升",
  previousPage: "上一页",
  nextPage: "下一页",
  adminConsoleBack: "返回管理控制台",
  adminUserSubtitle: (searchKeyword) => searchKeyword ? `搜索: "${searchKeyword}"` : "查看所有注册用户 · 管理管理员权限",
  adminUserTitle: "系统用户管理",
  adminUserCount: (count) => `${count} 用户`,
  adminSkillFileIdleSubtitle: "点击下方按钮进入上传等待状态，然后在当前会话发送一个 zip / tgz Skill 压缩包",
  adminSkillFileIdleHint: "平台层会先把飞书文件下载到服务器临时目录，再进入统一安装入口。Skill 最终名称在上传后的确认卡中填写或修改；确认后写入系统 catalog。仅支持单个 Skill 压缩包。",
  adminSkillFileIdleButton: "开始等待上传",
  adminSkillFileWaitingSubtitle: "已进入上传等待状态：请直接在当前会话发送一个 zip / tgz Skill 压缩包",
  adminSkillFileWaitingHint: "当前会话已开始等待文件上传。Skill 最终名称在上传后的确认卡中填写或修改；10 分钟内未上传会自动取消。",
  adminSkillFileWaitingButton: "等待文件上传中",
  mergeDecisionAccept: "接受当前结果",
  mergeDecisionKeepMain: "保留基线",
  mergeDecisionUseBranch: "使用分支",
  mergeDecisionSkip: "跳过",
  mergeStatusAutoMerged: "自动合并",
  mergeStatusAgentResolved: "Agent 解决",
  mergeStatusAgentPending: "Agent 处理中",
  mergeStatusConflict: "冲突",
  mergeStatusAdded: "新增",
  mergeStatusDeleted: "删除",
  mergeDiffTruncated: "\n... (truncated)",
  mergeDecisionKeepMainLabel: "保留基线",
  mergeDecisionUseBranchLabel: "使用分支",
  mergeDecisionSkipLabel: "跳过",
  mergeSummaryTitle: "合并汇总",
  mergeSummarySubtitle: (branchName, baseBranch, decided, total) => `${branchName} → ${baseBranch} · ${decided}/${total} 文件已决策`,
  pluginSourceGithubSubpath: "GitHub+路径",
  pluginSourceFeishuUpload: "飞书上传",
  adminSkillTagDownloaded: "<text_tag color='green'>已下载</text_tag>",
  adminSkillTagNotDownloaded: "<text_tag color='neutral'>未下载</text_tag>",
  adminSkillTagEnabled: "<text_tag color='blue'>当前项目已启用</text_tag>",
  adminSkillTagNotEnabled: "<text_tag color='neutral'>未启用</text_tag>",
  adminSkillTagHasMcp: "<text_tag color='indigo'>含 MCP</text_tag>",
  adminSkillDownloadedAt: (text) => `下载于 ${text}`,
  adminBackendReasoningHigh: "high — 深度推理",
  adminBackendReasoningMedium: "medium — 平衡",
  adminBackendReasoningLow: "low — 快速",
  adminBackendPersonalityFriendly: "friendly — 友好",
  adminBackendPersonalityPragmatic: "pragmatic — 务实",
  adminBackendPersonalityNone: "none — 无",
  adminBackendPolicyApproval: "审批策略",
  adminBackendPolicyApprovalOnRequest: "on-request (每次审批)",
  adminBackendPolicyApprovalNever: "never (全自动)",
  adminBackendPolicyApprovalUntrusted: "untrusted (最严格)",
  adminBackendPolicySandbox: "沙箱模式",
  adminBackendPolicySandboxWorkspaceWrite: "workspace-write (仅工作区可写)",
  adminBackendPolicySandboxReadOnly: "read-only (只读)",
  adminBackendPolicySandboxFullAccess: "danger-full-access (完全访问)",
  adminBackendPolicyQuestion: "Question 权限",
  adminBackendPolicyQuestionAllow: "allow (允许结构化提问)",
  adminBackendPolicyQuestionAsk: "ask (按后端策略询问)",
  adminBackendPolicyQuestionDeny: "deny (拒绝提问)",
  turnHistoryAccepted: "已接受",
  turnHistoryReverted: "已回退",
  turnHistoryInterrupted: "已中断",
  turnHistoryCompleted: "已完成",
  helpPanelThreads: "线程管理",
  helpPanelThreadsDesc: "查看 · 切换 · 新建线程",
  helpPanelMerge: "合并管理",
  helpPanelMergeDesc: "合并当前线程到 main",
  helpPanelHistory: "快照历史",
  helpPanelHistoryDesc: "浏览历史快照 · 回滚变更",
  helpPanelTurns: "历史会话",
  helpPanelTurnsDesc: "浏览过去的 Turn 记录",
  helpPanelSkills: "技能管理",
  helpPanelSkillsDesc: "查看 · 安装 · 卸载技能",
  helpPanelBackends: "后端概览",
  helpPanelBackendsDesc: "查看可用 Backend · Model",
  helpPanelProject: "项目管理",
  helpPanelProjectDesc: "项目配置 · Git · 推送",
  helpProjectTitle: "项目管理",
  helpProjectSubtitle: (name) => `${name} · 配置编辑`,
  helpProjectPathLabel: "工作目录",
  helpProjectIdLabel: "Project ID",
  helpProjectGitUrlLabel: "Git Remote URL",
  helpProjectGitUrlPlaceholder: "https://github.com/org/repo.git",
  helpProjectWorkBranchLabel: "工作分支",
  helpProjectWorkBranchPlaceholder: "collabvibe/my-project",
  helpProjectGitignoreLabel: ".gitignore (项目级)",
  helpProjectGitignorePlaceholder: "每行一个 pattern",
  helpProjectAgentsMdLabel: "AGENTS.md (项目级)",
  helpProjectAgentsMdPlaceholder: "Agent 行为约束",
  helpProjectSave: "保存配置",
  helpProjectPush: "Push 到 Remote",
  helpProjectBack: "返回命令帮助",
  helpProjectPushSuccess: "推送成功",
  helpProjectPushFailed: (err) => `推送失败: ${err}`,
  helpProjectSaveSuccess: "配置已保存",
  helpProjectSaveFailed: (err) => `保存失败: ${err}`,
  helpThreadManageBack: "返回线程管理",
  adminSkillFileDefaultHint: "10 分钟内",
  adminSkillFileDefaultSource: "Feishu 文件",
  adminSkillFileDefaultArchive: "未知",
  adminBackendInstallHint: (text) => `  ·  安装: ${text}`,
  adminBackendKeyConfigured: "✓ 已配置",
  adminBackendKeyNotConfigured: "✗ 未配置",
  searchButton: "搜索",
  mergePreviewChanged: (count, additions, deletions) => `**${count} 个文件变更**  (+${additions} / -${deletions})`,
  mergePreviewNoChanges: "无文件变更",
  mergeConflictResolverTag: "基线 / 分支 / Agent",
  mergeConflictResolverHelp: (threadName) => threadName
    ? `逐文件冲突解决模式：可保留 \`基线\`、使用分支版本，或让 Agent 先处理；当前 resolver 线程：\`${threadName}\``
    : "逐文件冲突解决模式：可保留 `基线`、使用分支版本，或在后续审阅阶段交给 Agent 处理",
  mergeForceHint: "使用 `/merge --force` 强制合并",
  mergeConflictCount: (count) => `**${count} 个冲突**`,
  mergeNoChangesCleanupHint: "该分支已与基线同步，无需合并",
  mergeNoChangesTitle: "分支管理",
  mergeCleanupWorktree: "**清理 Worktree**",
  mergeDeleteBranch: "**删除分支**",
  mergeReviewCancelConfirmTitle: "确认取消合并审阅",
  mergeReviewCancelConfirmText: "取消将丢弃当前所有审阅进度，分支将恢复到合并前的状态",
  mergeBatchRetrySelectLabel: "选择需要重修的文件",
  mergeBatchRetryFeedbackLabel: "修改要求",
  mergeBatchRetryFeedbackPlaceholder: "例: 保留 API 兼容性，不要删除现有校验",
  mergeBatchRetrySubmit: "添加重修",
  mergeDiffBaseline: (baseBranch) => `vs ${baseBranch} (merge base)`,
  mergeConfirm: "**确认合并**",
  mergeBack: "**返回上一级**",
  mergeConflictDetail: (hasResolverThread) => hasResolverThread
    ? "存在冲突，已进入逐文件冲突解决流程。每个文件可走 基线 / 分支 / Agent。使用 `/merge --force` 强制合并"
    : "存在冲突，无法自动合并。使用 `/merge --force` 强制合并",
  mergeStartReview: (hasResolverThread) => hasResolverThread ? "**继续逐文件处理**" : "**开始逐文件处理**",
  mergeCanMerge: "可合并",
  mergeHasConflict: "有冲突",
  mergePreviewSubtitle: "合并预览",
  mergeMergedFiles: (count, additions, deletions, fileList) => `**已合并 ${count} 个文件** (+${additions} / -${deletions})\n${fileList}`,
  mergeResultSuccess: "成功",
  mergeResultFailed: "失败",
  mergeResultSuccessSubtitle: "分支已合并并清理",
  mergeResultFailedSubtitle: "请检查冲突",
  mergeKeepThread: "**✓ 保留线程**",
  mergeDeleteThread: "**🗑 删除线程**",
  mergeKeepThreadSuccessSubtitle: "线程已保留，可继续使用",
  mergeDeleteThreadSuccessSubtitle: "线程已删除",
  mergeBackToThreads: "**返回 Threads**",
};

const enUS: FeishuCardBuilderStrings = {
  threadCurrentReadonly: "<text_tag color='green'>Current</text_tag> **Read only**",
  threadCurrent: "<text_tag color='green'>Current</text_tag>",
  threadCreating: "<text_tag color='orange'>Creating</text_tag>",
  threadCreatingDetail: (backendName, modelName) => {
    const backend = backendName ? ` · ${backendName}` : "";
    const model = modelName ? ` / ${modelName}` : "";
    return `⏳ Creating${backend}${model}`;
  },
  threadSwitch: "Switch",
  threadMainDescription: "**main** (default branch)\n🔒 Protected · writable only via `/merge`",
  threadListTitle: "Threads",
  threadListSubtitle: (displayName) => displayName ? `${displayName}'s threads · click to switch` : "Click to switch",
  threadListCount: (count) => `${count}`,
  snapshotNoSummary: "(No summary)",
  snapshotJump: "Jump",
  snapshotFiles: (count) => `📝 ${count} files`,
  snapshotBackToHelp: "Back to help",
  snapshotMainTitle: "main · merge history",
  snapshotThreadTitle: (name) => `${name} · snapshot history`,
  snapshotMainSubtitle: "A snapshot is recorded on every /merge",
  snapshotThreadSubtitle: "Click to jump to any version",
  snapshotVersionCount: (count) => `${count} versions`,
  threadCreatedTitle: "✅ Thread created",
  threadCreatedName: "🧵 **Name**",
  threadCreatedId: "🆔 **ID**",
  threadCreatedBackend: "⚙️ **Backend**",
  threadCreatedModel: "🤖 **Model**",
  threadCreatedHint: "💡 You can now mention @bot directly in this thread",
  threadNameLabel: "Thread name",
  threadNamePlaceholder: "e.g. feature-auth",
  threadNameHint: "Letters, numbers, and - only, e.g. feature-auth",
  backendModelLabel: "Backend · model",
  backendModelPlaceholder: "Choose backend and model",
  createThread: "Create thread",
  helpThreadNewTitle: "New thread",
  helpThreadNewSubtitle: "Choose backend and model, then create",
  currentModelTag: "🟢 **Current model**",
  modelSwitch: "Switch",
  modelListTitle: (threadName) => threadName ? `🤖 Models · ${threadName}` : "🤖 Models",
  modelListSubtitle: (currentModel) => `Current: ${currentModel}`,
  helpThreadMainDescription: "**main** (default branch)\n🔒 Protected · writable only via merge",
  helpThreadNewHover: "Choose backend and model to create a new thread",
  helpThreadNewEntry: "**Create new thread**",
  helpThreadNewEntryHint: "Choose backend · model · create",
  helpThreadBack: "Back to help",
  helpThreadTitle: "Thread management",
  helpThreadSubtitle: (displayName) => displayName ? `${displayName}'s threads · switch or create` : "Switch or create a thread",
  turnHistoryEmpty: "No turns yet. A turn will be created after you send a message.",
  turnHistoryDefaultSummary: "Turn record",
  turnHistoryBack: "Back to help",
  turnHistoryTitle: "History",
  turnHistorySubtitle: (count) => `${count} turns`,
  initBindExisting: (count) => `**Bind existing project**\nConnect an existing unbound project to this chat (${count} available)`,
  initCreateNew: "**Create project**\nCreate a new project directory and bind it to this chat",
  initTitle: "CollabVibe project setup",
  initSubtitle: "Choose an action first: bind an existing project or create a new one",
  initTagInit: "Setup",
  initTagPending: "Pending",
  initIntro: "When the bot first joins a chat, choose a setup method from the top-level menu.",
  initBack: "Back to setup",
  initBindHint: "Choose an existing project that is not bound to any chat and bind it here.",
  initNoUnbound: "No unbound projects are available. Go back and choose Create project.",
  initBindToCurrentChat: "Bind to this chat",
  initBindTitle: "CollabVibe bind existing project",
  initBindSubtitle: "Choose an unbound project and connect it to this chat",
  initBindTag: "Bind existing",
  initCreateFields: [
    { label: "Project name", placeholder: "e.g. my-project" },
    { label: "Workspace directory", placeholder: "my-project", hint: "Subdirectory name. Leave empty to use the project name." },
    { label: "Git repository URL", placeholder: "https://github.com/org/repo.git", hint: "Optional. Leave empty to run git init." },
    { label: "Clone token", placeholder: "ghp_xxxx or PAT", hint: "Optional. Use for private repositories." },
    { label: "Work branch", placeholder: "dev", hint: "Optional. Leave empty to use collabvibe/{project name}." },
  ],
  initCreateSubmit: "Create project",
  initCreateTitle: "CollabVibe create project",
  initCreateSubtitle: "Fill in the project info and bind it to this chat",
  initCreateTag: "Create project",
  projectResumedProject: "Project",
  projectResumedId: "ID",
  projectResumedDir: "Directory",
  projectResumedRepo: "Repository",
  projectResumedLocalGit: "(local git)",
  projectResumedHint: "✅ Project restored. You can continue using it.",
  projectResumedTitle: "Project restored",
  projectResumedSubtitle: (name) => `${name} · rebound`,
  initSuccessName: "Name",
  initSuccessId: "ID",
  initSuccessDir: "Directory",
  initSuccessRepo: "Repository",
  initSuccessBranch: "Work branch",
  initSuccessOwner: "Owner",
  initSuccessLocalGit: "(local git init)",
  initSuccessHint: "You can now talk directly to @bot",
  initSuccessTitle: "Project created",
  helpMergeOnMain: "You are on main. Switch to a thread first before merging.",
  helpMergeGoThreads: "**Go to thread management**",
  helpMergeCurrentBranch: (name) => `Current branch: **${name}**\nClick below to preview the merge result`,
  helpMergePreview: (name) => `**Preview merge ${name} → main**`,
  helpMergeBack: "Back to help",
  helpMergeTitle: "Merge management",
  helpMergeSubtitle: (name) => name ? `${name} → main` : "Switch to a branch first",
  helpSkillEmpty: "No skills available. Ask an administrator to add them from the admin console.",
  helpSkillInstalled: "<text_tag color='green'>Installed</text_tag>",
  helpSkillNotInstalled: "<text_tag color='neutral'>Not installed</text_tag>",
  helpSkillRemove: "Remove",
  helpSkillRemoveConfirmTitle: (name) => `Remove "${name}"?`,
  helpSkillRemoveConfirmText: "You can install it again later.",
  helpSkillInstall: "Install",
  helpSkillNoDescription: "No description",
  helpSkillBack: "Back to help",
  helpSkillTitle: "Skill management",
  helpSkillSubtitle: (installed, total) => `${installed}/${total} installed`,
  helpBackendEmpty: "No backends available. Ask an administrator to configure one.",
  helpBackendNoModels: "No available models",
  helpBackendHint: "💡 You can choose any backend · model pair above when creating a new thread",
  helpBackendBack: "Back to help",
  helpBackendTitle: "Backend overview",
  helpBackendSubtitle: (count) => `${count} engines`,
  adminPanels: [
    { label: "Project management", desc: "Overview of projects / chats / members" },
    { label: "User management", desc: "System users · admin permissions" },
    { label: "Member management", desc: "Manage member roles by project" },
    { label: "Skill management", desc: "System installs and project enablement" },
    { label: "Backend configuration", desc: "Engines, providers, and models" },
  ],
  adminPrivateOnly: "🔒 Admin DM only · use group commands in project chats",
  adminHelpTitle: "Admin console",
  adminHelpSubtitle: "Open a panel to manage the corresponding area",
  adminProjectSearchPlaceholder: "Search projects by name",
  adminProjectEmpty: (searchKeyword) => searchKeyword ? `No project matched "${searchKeyword}"` : "No projects yet. Add the bot to a group to initialize one automatically.",
  adminProjectEdit: "Edit",
  adminProjectDisable: "Disable",
  adminProjectEnable: "Enable",
  adminProjectUnbind: "Unbind",
  adminProjectUnbindConfirmTitle: (name) => `Unbind "${name}"?`,
  adminProjectUnbindConfirmText: "The bot will leave the chat and the project will become unbound. You can bind it to another chat later.",
  adminProjectDelete: "Delete",
  adminProjectDeleteConfirmTitle: (name) => `Delete project "${name}"?`,
  adminProjectDeleteConfirmText: "This action cannot be undone. The bot will leave the chat and project/member data will be permanently deleted.",
  adminProjectMemberCount: (count) => `${count} members`,
  adminProjectBack: "Back to admin console",
  adminProjectTitle: "Project management",
  adminProjectSubtitle: (searchKeyword) => searchKeyword ? `Search: "${searchKeyword}"` : "Overview of projects / directories / members",
  adminProjectCount: (count) => `${count} projects`,
  localGitLabel: "local git",
  adminMemberSearchPlaceholder: "Search projects by name",
  adminMemberEmpty: (searchKeyword) => searchKeyword ? `No project matched "${searchKeyword}"` : "No projects yet. Initialize one in a group chat first.",
  adminMemberProjectLine: (name, count) => `**${name}** · ${count} members`,
  adminMemberNoMembers: "No members yet. Users are auto-registered as auditor after joining the chat.",
  adminMemberSelectRole: "Select role",
  adminMemberHint: "💡 New users are auto-registered as auditor. Admins can promote them from the dropdown.",
  adminMemberBack: "Back to admin console",
  adminMemberTitle: "Project member management",
  adminMemberSubtitle: (searchKeyword) => searchKeyword ? `Search: "${searchKeyword}"` : "Manage member roles by project",
  adminMemberCount: (count) => `${count} members`,
  adminSkillNoDescription: "No description",
  adminSkillGithubInstall: "Install from GitHub",
  adminSkillFeishuInstall: "Install from Feishu file",
  adminSkillRefresh: "Refresh",
  adminSkillCurrentProject: (name) => `Current project: ${name ?? "unbound"}`,
  adminSkillDownloaded: (count) => `downloaded ${count}`,
  adminSkillEnabled: (count) => `enabled ${count}`,
  adminSkillEmpty: "No extensions yet. Use the buttons above to start installing.",
  adminSkillPendingDownload: "Pending download",
  adminSkillDisable: "Disable",
  adminSkillEnable: "Enable",
  adminSkillUnboundHint: "No project bound: only downloaded extensions are shown, and enable/disable is unavailable.",
  adminSkillViewFullDescription: "View full description",
  adminSkillBack: "Back to admin console",
  adminSkillTitle: "Extension management",
  adminSkillSubtitle: (name) => name ? `${name} · plugins/skills` : "Plugin/skill download and enablement",
  adminSkillCount: (count) => `${count} extensions`,
  adminBackendEmpty: "No backend engines configured.",
  adminBackendProfileCount: (count) => `${count} models`,
  adminBackendNoModels: "No models",
  adminBackendProviderCount: (count, modelInfo, installHint) => `${count} providers · ${modelInfo}${installHint}`,
  adminBackendBack: "Back to admin console",
  adminBackendTitle: "Backend configuration",
  adminBackendSubtitle: "Engines · providers · models",
  adminBackendCount: (count) => `${count} engines`,
  adminSkillInstallTitle: "Install from GitHub",
  adminSkillInstallSubtitle: "Currently supports GitHub repository + skill subpath only",
  adminSkillInstallHint: "Admins install to the system catalog; maintainers enable it per project from the project panel. MCP declarations are parsed only; dependencies are not auto-installed.",
  adminSkillInstallSourcePlaceholder: "GitHub repository URL",
  adminSkillInstallSubpathPlaceholder: "Skill subpath, e.g. .claude/skills/ui-ux-pro-max",
  adminSkillInstallNamePlaceholder: "Install name (optional)",
  adminSkillInstallActionPlaceholder: "Post-download action",
  adminSkillInstallCatalogOnly: "Download to catalog only",
  adminSkillInstallToProject: "Download and enable for current project",
  adminSkillInstallStart: "Start installation",
  adminSkillInstallBack: "Back to extension management",
  adminSkillFileTitle: "Install from Feishu file",
  adminSkillFileActionPlaceholder: "Post-download action",
  adminSkillFileBack: "Back to extension management",
  adminSkillFileConfirmTitle: "Confirm skill file installation",
  adminSkillFileConfirmSubtitle: "The file has been uploaded to a temporary server directory and will be installed only after confirmation",
  adminSkillFileConfirmExpires: (hint) => `**⚠️ Confirm installation within ${hint}, otherwise the system will cancel it automatically and delete the temporary file.**`,
  adminSkillFileConfirmValidation: (error) => `**Name validation failed:** ${error}`,
  adminSkillFileLabelFile: (name) => `File: ${name}`,
  adminSkillFileLabelSource: (name) => `Source: ${name}`,
  adminSkillFileLabelArchive: (name) => `Archive format: ${name}`,
  adminSkillFileLabelManifest: (name) => `Manifest name: ${name}`,
  adminSkillFileLabelManifestFallback: "Not declared; fell back to admin input or file name",
  adminSkillFileLabelManifestDescription: (name) => `Manifest description: ${name}`,
  adminSkillFileLabelPostAction: (text) => `Post-download action: ${text}`,
  adminSkillFilePostAction: (projectName) => `Download and enable for current project${projectName ? ` (${projectName})` : ""}`,
  adminSkillFileCatalogOnly: "Download to catalog only",
  adminSkillFileFinalNamePlaceholder: "Final skill name",
  adminSkillFileConfirmInstall: "Confirm install",
  adminSkillFileCancel: "Cancel",
  adminBackendEditMissingProvider: "No models",
  adminBackendRemoveProvider: "Remove provider",
  adminBackendRemoveProviderConfirmTitle: (name) => `Remove provider "${name}"?`,
  adminBackendRemoveProviderConfirmText: "All models under this provider will also be deleted. This action cannot be undone.",
  adminBackendAvailable: "<font color='green'>available</font>",
  adminBackendUnavailable: "<font color='red'>unavailable</font>",
  adminBackendChecking: "<font color='grey'>checking</font>",
  adminBackendNoModelsConfigured: "No models",
  adminBackendRunPolicy: "Run policy",
  adminBackendAddProvider: "Add provider",
  adminBackendModelManage: (count) => `Model management · ${count} models`,
  adminBackendBackToConfig: (name) => `Back to ${name} config`,
  adminBackendEditSubtitle: (name) => `Backend config › ${name}`,
  adminBackendProviderCountOnly: (count) => `${count} providers`,
  adminBackendDelete: "Delete",
  adminBackendDeleteModelConfirmTitle: (name) => `Delete model "${name}"?`,
  adminBackendDeleteModelConfirmText: "You will need to add it again later. Continue?",
  adminBackendProviderLabel: "Provider",
  adminBackendChooseProvider: "Choose provider",
  adminBackendNoProvider: "No provider",
  adminBackendModelName: "Model name",
  adminBackendModelPlaceholder: "e.g. gpt-5.3-codex",
  adminBackendProfileName: "Profile name",
  adminBackendProfilePlaceholder: "e.g. 5.3-codex-high",
  adminBackendReasoningEffort: "Reasoning Effort",
  adminBackendChooseReasoning: "Choose reasoning effort",
  adminBackendPersonality: "Personality",
  adminBackendChoosePersonality: "Choose style",
  adminBackendThinkingBudget: "Thinking Budget Tokens",
  adminBackendThinkingBudgetPlaceholder: "e.g. 8192",
  adminBackendContextLimit: "Context Limit",
  adminBackendContextLimitPlaceholder: "e.g. 202752",
  adminBackendOutputLimit: "Output Limit",
  adminBackendOutputLimitPlaceholder: "e.g. 16384",
  adminBackendInputModalities: "Input modalities",
  adminBackendChooseInputModalities: "Choose input modalities",
  adminBackendOutputModalities: "Output modalities",
  adminBackendChooseOutputModalities: "Choose output modalities",
  adminBackendNewModel: "Create model",
  adminBackendModelCardTitle: (name) => `${name} › create model`,
  adminBackendModelCardSubtitle: "Each profile = model + backend parameters. Choose a profile when creating a thread.",
  adminBackendPolicyTitle: "Run policy",
  adminBackendPolicySubtitle: (name) => `Backend config › ${name} › run policy`,
  adminBackendSavePolicy: "Save policy",
  adminBackendBackToBackend: (name) => `Back to ${name}`,
  adminBackendAddProviderTitle: "Add provider",
  adminBackendAddProviderSubtitle: (name) => `Backend config › ${name} › add provider`,
  adminBackendProviderName: "Provider name",
  adminBackendProviderNamePlaceholder: "Provider name",
  adminBackendBaseUrl: "Base URL",
  adminBackendBaseUrlPlaceholder: "Base URL",
  adminBackendApiKey: (labelCodex) => labelCodex ? "API key" : "API key / env var name",
  adminBackendApiKeyPlaceholder: (labelCodex) => labelCodex ? "sk-xxx" : "API key or env var name (e.g. MY_API_KEY)",
  adminBackendAddProviderSubmit: "Add provider",
  mergeReviewTitle: (index, total) => `Merge review (${index}/${total})`,
  mergeReviewViewDiff: "View diff",
  mergeReviewRejectHint: "The system will automatically include the default English merge prompt and a snippet of the current file. Enter only extra instructions here.",
  mergeReviewFeedbackLabel: "Additional feedback (optional, sent to agent)",
  mergeReviewFeedbackPlaceholder: "e.g. Keep input validation and preserve the CLI entrypoint",
  mergeReviewRejectAction: "Reject and send to agent",
  mergeReviewOverviewTitle: "**Overview**",
  mergeReviewOverview: (decided, total, pendingConflicts, pendingDirect, agentPending) => `Decided ${decided}/${total} · unresolved conflicts ${pendingConflicts} · results to confirm ${pendingDirect} · agent running ${agentPending}`,
  mergeReviewQueueConflict: (count, list) => `**Unresolved conflicts (${count})**\n${list}`,
  mergeReviewQueueDirect: (count, list) => `**Results to confirm (${count})**\n${list}`,
  mergeReviewQueueAgentPending: (count, list) => `**Agent processing in batch (${count})**\n${list}`,
  mergeReviewRecoveryRequiredTitle: "**Recovery required**",
  mergeReviewRecoveryRequiredBody: (reason) => `This merge session no longer matches the git worktree and cannot continue.\nReason: ${reason}`,
  mergeReviewRecoveryRollback: "Rollback and clean this merge",
  mergeReviewOpenFile: "Review files one by one",
  mergeReviewNoPendingFiles: "There are no pending files right now",
  mergeReviewAgentAssist: "Agent assist",
  mergeReviewAgentAssistSubtitle: (branchName, count) => `${branchName} · ${count} conflicts remaining`,
  mergeReviewAgentAssistWarning: "After confirmation, the agent will take over the remaining unresolved conflict files. Files modified by the agent can no longer switch back to manual base/branch selection.",
  mergeReviewAgentAssistPromptLabel: "Extra instructions (optional)",
  mergeReviewAgentAssistPromptPlaceholder: "e.g. Prioritize API compatibility and keep the current validation logic",
  mergeReviewAgentAssistConfirm: "Confirm agent takeover",
  mergeReviewAgentAssistBack: "Back to review overview",
  mergeReviewCurrentFileTitle: "**Current file**",
  mergeReviewFileActionsTitle: "**Current file**",
  mergeReviewSessionActionsTitle: "**Review session**",
  mergeReviewAutoMergedHint: "The system already produced a merged result for this file. Confirm it, or switch to keeping the base version or the branch version.",
  mergeReviewAgentResolvedHint: "The agent produced the current result. You can accept it directly or send more instructions and ask the agent to retry.",
  mergeReviewConflictHint: "This file still has conflicts. Choose either the base version or the branch version before continuing.",
  mergeReviewAddedHint: "This file is new on the branch. Accepting the current result will include it in the merge; skipping leaves it out.",
  mergeReviewDeletedHint: "This change deletes the file. Accepting the current result removes it; keeping base preserves it.",
  mergeReviewBatchAcceptHint: "This only accepts the remaining non-conflict files. It does not resolve conflicts for you.",
  mergeReviewBatchResolveConflicts: (count) => `**Let the agent resolve the remaining conflicts in batch** (${count} conflicts)`,
  mergeReviewResolvingConflicts: (count) => `The agent is processing the remaining **${count}** conflict files in batch. This card will return to the review overview automatically when it finishes.`,
  mergeReviewAcceptAll: (remaining) => `**Batch-accept the remaining directly reviewable files** (${remaining} files remaining)`,
  mergeReviewProgress: (accepted, rejected, remaining, pct) => `Progress: accepted ${accepted} · rejected ${rejected} · remaining ${remaining} (${pct}%)`,
  mergeSummaryAccepted: (count, list) => `**Accepted current result (${count})**\n${list}`,
  mergeSummaryKeepMain: (count, list) => `**Kept base (${count})**\n${list}`,
  mergeSummaryUseBranch: (count, list) => `**Used branch (${count})**\n${list}`,
  mergeSummarySkipped: (count, list) => `**Skipped (${count})**\n${list}`,
  mergeSummaryPartialWarning: "Some files are not using the current merged result. Confirm this is intentional before committing the merge.",
  mergeSummaryCommit: "Commit merge",
  mergeSummaryCancel: "Cancel this merge review",
  helpNoMembers: "No members yet",
  helpMemberUser: "**User**",
  helpMemberRole: "**Role**",
  helpSelectRole: "Choose role",
  helpMemberManagement: "**Member management**",
  helpPromptTip: "💡 @bot + natural language = prompt interaction, no command needed",
  helpOpenPanelTip: "💡 Open this card again by mentioning @bot with an empty message",
  helpTitle: (projectName) => projectName ? `${projectName} · Command help` : "Project command help",
  helpSubtitle: "Open a panel below · mention @bot with natural language",
  adminProjectNameLabel: "**Project name**",
  adminProjectNamePlaceholder: "Project name",
  adminProjectGitUrlLabel: "**Git repository URL**",
  adminProjectChatBindingLabel: "**Chat binding**",
  adminProjectCurrentBinding: (chatId) => `Current binding: ${chatId}`,
  adminProjectNoBinding: "No chat is currently bound",
  adminProjectUnbindChat: "Unbind chat",
  adminProjectUnbindChatConfirmTitle: "Unbind chat?",
  adminProjectUnbindChatConfirmText: "The bot will leave the chat and the project will become unbound.",
  save: "Save",
  adminProjectEditTitle: "Edit project",
  adminProjectEditBack: "Back to project management",
  adminUserSearchPlaceholder: "Search by username",
  adminUserEmpty: (searchKeyword) => searchKeyword ? `No users matched \"${searchKeyword}\"` : "No registered users yet",
  adminUserSourceLockedEnv: "env · locked",
  adminUserSourceFeishu: "Feishu",
  adminUserLocked: "Locked",
  adminUserDemote: "Demote",
  adminUserDemoteConfirmTitle: (name) => `Demote \"${name}\"?`,
  adminUserDemoteConfirmText: "This user will lose administrator privileges.",
  adminUserPromote: "Promote",
  previousPage: "Previous",
  nextPage: "Next",
  adminConsoleBack: "Back to admin console",
  adminUserSubtitle: (searchKeyword) => searchKeyword ? `Search: \"${searchKeyword}\"` : "View all registered users · manage admin privileges",
  adminUserTitle: "System user management",
  adminUserCount: (count) => `${count} users`,
  adminSkillFileIdleSubtitle: "Click the button below to enter upload waiting state, then send a zip / tgz skill archive in this chat",
  adminSkillFileIdleHint: "The platform layer first downloads the Feishu file to a temporary server directory, then enters the unified install flow. The final skill name can be filled in or changed in the confirmation card after upload. Only a single skill archive is supported.",
  adminSkillFileIdleButton: "Start waiting for upload",
  adminSkillFileWaitingSubtitle: "Upload waiting has started: send a zip / tgz skill archive directly in this chat",
  adminSkillFileWaitingHint: "This chat is now waiting for a file upload. The final skill name can be filled in or changed in the confirmation card after upload. If no file is uploaded within 10 minutes, it will be canceled automatically.",
  adminSkillFileWaitingButton: "Waiting for file upload",
  mergeDecisionAccept: "Accept current result",
  mergeDecisionKeepMain: "Keep base",
  mergeDecisionUseBranch: "Use branch",
  mergeDecisionSkip: "Skip",
  mergeStatusAutoMerged: "Auto merged",
  mergeStatusAgentResolved: "Agent resolved",
  mergeStatusAgentPending: "Agent processing",
  mergeStatusConflict: "Conflict",
  mergeStatusAdded: "Added",
  mergeStatusDeleted: "Deleted",
  mergeDiffTruncated: "\n... (truncated)",
  mergeDecisionKeepMainLabel: "Keep base",
  mergeDecisionUseBranchLabel: "Use branch",
  mergeDecisionSkipLabel: "Skip",
  mergeSummaryTitle: "Merge summary",
  mergeSummarySubtitle: (branchName, baseBranch, decided, total) => `${branchName} → ${baseBranch} · ${decided}/${total} files decided`,
  pluginSourceGithubSubpath: "GitHub + path",
  pluginSourceFeishuUpload: "Feishu upload",
  adminSkillTagDownloaded: "<text_tag color='green'>Downloaded</text_tag>",
  adminSkillTagNotDownloaded: "<text_tag color='neutral'>Not downloaded</text_tag>",
  adminSkillTagEnabled: "<text_tag color='blue'>Enabled for current project</text_tag>",
  adminSkillTagNotEnabled: "<text_tag color='neutral'>Not enabled</text_tag>",
  adminSkillTagHasMcp: "<text_tag color='indigo'>Has MCP</text_tag>",
  adminSkillDownloadedAt: (text) => `Downloaded at ${text}`,
  adminBackendReasoningHigh: "high — deep reasoning",
  adminBackendReasoningMedium: "medium — balanced",
  adminBackendReasoningLow: "low — fast",
  adminBackendPersonalityFriendly: "friendly — friendly",
  adminBackendPersonalityPragmatic: "pragmatic — pragmatic",
  adminBackendPersonalityNone: "none — none",
  adminBackendPolicyApproval: "Approval policy",
  adminBackendPolicyApprovalOnRequest: "on-request (approve each time)",
  adminBackendPolicyApprovalNever: "never (fully automatic)",
  adminBackendPolicyApprovalUntrusted: "untrusted (strictest)",
  adminBackendPolicySandbox: "Sandbox mode",
  adminBackendPolicySandboxWorkspaceWrite: "workspace-write (workspace writable only)",
  adminBackendPolicySandboxReadOnly: "read-only",
  adminBackendPolicySandboxFullAccess: "danger-full-access (full access)",
  adminBackendPolicyQuestion: "Question permission",
  adminBackendPolicyQuestionAllow: "allow (structured questions allowed)",
  adminBackendPolicyQuestionAsk: "ask (follow backend policy)",
  adminBackendPolicyQuestionDeny: "deny (reject questions)",
  turnHistoryAccepted: "Accepted",
  turnHistoryReverted: "Reverted",
  turnHistoryInterrupted: "Interrupted",
  turnHistoryCompleted: "Completed",
  helpPanelThreads: "Thread management",
  helpPanelThreadsDesc: "View · switch · create threads",
  helpPanelMerge: "Merge management",
  helpPanelMergeDesc: "Merge current thread into main",
  helpPanelHistory: "Snapshot history",
  helpPanelHistoryDesc: "Browse snapshots · roll back changes",
  helpPanelTurns: "Turn history",
  helpPanelTurnsDesc: "Browse previous turns",
  helpPanelSkills: "Skill management",
  helpPanelSkillsDesc: "View · install · remove skills",
  helpPanelBackends: "Backend overview",
  helpPanelBackendsDesc: "View available backends · models",
  helpPanelProject: "Project settings",
  helpPanelProjectDesc: "Project config · Git · Push",
  helpProjectTitle: "Project Settings",
  helpProjectSubtitle: (name) => `${name} · Configuration`,
  helpProjectPathLabel: "Working directory",
  helpProjectIdLabel: "Project ID",
  helpProjectGitUrlLabel: "Git Remote URL",
  helpProjectGitUrlPlaceholder: "https://github.com/org/repo.git",
  helpProjectWorkBranchLabel: "Work branch",
  helpProjectWorkBranchPlaceholder: "collabvibe/my-project",
  helpProjectGitignoreLabel: ".gitignore (project-level)",
  helpProjectGitignorePlaceholder: "One pattern per line",
  helpProjectAgentsMdLabel: "AGENTS.md (project-level)",
  helpProjectAgentsMdPlaceholder: "Agent behavior constraints",
  helpProjectSave: "Save",
  helpProjectPush: "Push to Remote",
  helpProjectBack: "Back to help",
  helpProjectPushSuccess: "Push succeeded",
  helpProjectPushFailed: (err) => `Push failed: ${err}`,
  helpProjectSaveSuccess: "Settings saved",
  helpProjectSaveFailed: (err) => `Save failed: ${err}`,
  helpThreadManageBack: "Back to thread management",
  adminSkillFileDefaultHint: "10 minutes",
  adminSkillFileDefaultSource: "Feishu file",
  adminSkillFileDefaultArchive: "unknown",
  adminBackendInstallHint: (text) => `  ·  Install: ${text}`,
  adminBackendKeyConfigured: "✓ configured",
  adminBackendKeyNotConfigured: "✗ not configured",
  searchButton: "Search",
  mergePreviewChanged: (count, additions, deletions) => `**${count} file${count > 1 ? "s" : ""} changed**  (+${additions} / -${deletions})`,
  mergePreviewNoChanges: "No file changes",
  mergeConflictResolverTag: "Base / Branch / Agent",
  mergeConflictResolverHelp: (threadName) => threadName
    ? `Per-file conflict resolution: keep \`base\`, use the branch version, or let the agent handle it first; current resolver thread: \`${threadName}\``
    : "Per-file conflict resolution: keep `base`, use the branch version, or hand it to the agent during the review stage",
  mergeForceHint: "Use `/merge --force` to force the merge",
  mergeConflictCount: (count) => `**${count} conflicts**`,
  mergeNoChangesCleanupHint: "This branch is up to date with the base. No merge needed.",
  mergeNoChangesTitle: "Branch management",
  mergeCleanupWorktree: "**Clean up worktree**",
  mergeDeleteBranch: "**Delete branch**",
  mergeReviewCancelConfirmTitle: "Confirm cancel merge review",
  mergeReviewCancelConfirmText: "Canceling will discard all review progress. The branch will be restored to its pre-merge state.",
  mergeBatchRetrySelectLabel: "Select files to re-process",
  mergeBatchRetryFeedbackLabel: "Instructions",
  mergeBatchRetryFeedbackPlaceholder: "e.g. Prioritize API compatibility and keep the current validation logic",
  mergeBatchRetrySubmit: "Add retry",
  mergeDiffBaseline: (baseBranch) => `vs ${baseBranch} (merge base)`,
  mergeConfirm: "**Confirm merge**",
  mergeBack: "**Back**",
  mergeConflictDetail: (hasResolverThread) => hasResolverThread
    ? "Conflicts exist and per-file conflict resolution has started. Each file can use Base / Branch / Agent. Use `/merge --force` to force the merge"
    : "Conflicts exist and automatic merge is not possible. Use `/merge --force` to force the merge",
  mergeStartReview: (hasResolverThread) => hasResolverThread ? "**Continue per-file review**" : "**Start per-file review**",
  mergeCanMerge: "Mergeable",
  mergeHasConflict: "Conflicts",
  mergePreviewSubtitle: "Merge preview",
  mergeMergedFiles: (count, additions, deletions, fileList) => `**Merged ${count} file${count > 1 ? "s" : ""}** (+${additions} / -${deletions})\n${fileList}`,
  mergeResultSuccess: "Success",
  mergeResultFailed: "Failed",
  mergeResultSuccessSubtitle: "Branch merged and cleaned up",
  mergeResultFailedSubtitle: "Check conflicts",
  mergeKeepThread: "**✓ Keep thread**",
  mergeDeleteThread: "**🗑 Delete thread**",
  mergeKeepThreadSuccessSubtitle: "Thread kept and ready to use",
  mergeDeleteThreadSuccessSubtitle: "Thread deleted",
  mergeBackToThreads: "**Back to Threads**",
};

export function getFeishuCardBuilderStrings(locale: AppLocale = DEFAULT_APP_LOCALE): FeishuCardBuilderStrings {
  return locale === "en-US" ? enUS : zhCN;
}
