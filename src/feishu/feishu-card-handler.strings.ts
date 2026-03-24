import type { AppLocale } from "../common/app-locale";

export interface FeishuCardHandlerStrings {
  skillUploadTimeout: string;
  skillUploadWaiting: string;
  noPendingSkillInstall: string;
  skillInstallCanceled: string;
  threadCreated(threadName: string, backendId: string, model: string, threadIdPrefix: string): string;
  creatingThreadTitle(threadName: string): string;
  creatingThreadBody(backendId: string): string;
  creatingThreadFailedTitle(threadName: string): string;
  creatingThreadFailedBody(message: string): string;
  approvalApproved: string;
  approvalRejected: string;
  approvalApprovedOnce: string;
  approvalTitleFileChange: string;
  approvalTitleCommand: string;
  approvalTypeFileChange: string;
  approvalTypeCommand: string;
  approvalThreadNameTitle: string;
  approvalSummaryTitle: string;
  approvalResultTitle: string;
  approvalOperationTitle: string;
  approvalCommandTitleText: string;
  approvalReasonTitle: string;
  approvalStatusReasonTitle: string;
  approvalWorkingDirectoryTitle: string;
  approvalFilesTitle: string;
  approvalMoreFiles(count: number): string;
  approvalHandledAt(time: string): string;
  approvalHandledNote: string;
  approvalExpiredTitle: string;
  approvalExpiredBody: string;
  approvalDuplicateTitle: string;
  approvalDuplicateBody: string;
  approvalInvalidTitle: string;
  approvalInvalidBody: string;
  mergeCanceledTitle(branchName: string): string;
  mergeReviewCanceledTitle(branchName: string): string;
  branchUnchanged: string;
  mergeCanceledBody(branchName: string, baseBranch?: string): string;
  mergeReviewCanceledBody(branchName: string, baseBranch?: string): string;
  backToMergePanel: string;
  feishuFileSourceLabel: string;
  skillInstallExpiresHint: string;
  invalidSkillName: string;
  localSkillImportUnavailable: string;
  skillNameValidationUnavailable: string;
  githubSubpathOnly: string;
  githubSubpathRequired: string;
  githubSubpathImportUnavailable: string;
  installTaskDownloading: string;
  installTaskDownloaded: string;
  skillInstallCompleted(fileName: string): string;
  skillInstallFailed(message: string): string;
  planSelectionSubmittedTitle: string;
  planSelectionSubmittedTag: string;
  planModeTag: string;
  planSelectionSubmitted(actorId: string, timeStr: string): string;
  alignBackProjectManagement: string;
  alignSave: string;
  turnDetailMissing: string;
  turnRecordMissing: string;
  turnRecoveryFailed(label: string, turnId: string, projectId: string, chatId: string): string;
  invalidPathChars: string;
  relativePathRequired: string;
  pathEmpty: string;
  pathParentNotAllowed: string;
  pathWhitelistError: string;
  pathTooLong: string;
  snapshotContextReset(turnIndex: number): string;
  submitUserInputFailed(message: string): string;
  mergeRetrying(filePath: string): string;
  enablePluginNoProject: string;
  genericError(message: string): string;
  asyncProgressHint: string;
  asyncInProgressTag: string;
  asyncFailedTag: string;
  asyncPushTitle: string;
  asyncPushBody(branchName: string): string;
  asyncRevertTurnTitle: string;
  asyncRevertTurnBody(turnId: string): string;
  asyncAcceptTurnTitle: string;
  asyncAcceptTurnBody(turnId: string): string;
  asyncApprovalDecisionTitle: string;
  asyncApprovalDecisionBody(decision: string): string;
  asyncSubmitUserInputTitle: string;
  asyncSubmitUserInputBody: string;
  asyncEnableSkillTitle: string;
  asyncEnableSkillBody(skillName: string): string;
  asyncRunMergeTitle: string;
  asyncRunMergeBody(branchName: string): string;
  asyncPreviewMergeTitle: string;
  asyncPreviewMergeBody(branchName: string): string;
  asyncCancelMergeReviewTitle: string;
  asyncCancelMergeReviewBody(branchName: string): string;
  asyncStartMergeReviewTitle: string;
  asyncStartMergeReviewBody(branchName: string): string;
  asyncRetryMergeFileTitle: string;
  asyncRetryMergeFileBody(filePath: string): string;
  asyncBatchRetryMergeTitle: string;
  asyncBatchRetryMergeBody(count: number): string;
  asyncJumpSnapshotTitle: string;
  asyncJumpSnapshotBody(turnId: string): string;
  asyncAcceptAllMergeTitle: string;
  asyncAcceptAllMergeBody(branchName: string): string;
  asyncAgentTakeoverTitle: string;
  asyncAgentTakeoverBody(branchName: string): string;
  asyncCommitMergeTitle: string;
  asyncCommitMergeBody(branchName: string): string;
  asyncDeleteThreadTitle: string;
  asyncDeleteThreadBody(threadName: string): string;
  asyncSearchUsersTitle: string;
  asyncSearchUsersBody(keyword: string): string;
  asyncInstallSkillTitle: string;
  asyncInstallSkillBody: string;
  asyncSwitchThreadTitle: string;
  asyncSwitchThreadBody(threadName: string): string;
  asyncSwitchToMainTitle: string;
  asyncSwitchToMainBody: string;
  asyncRevertTurnFailedTitle: string;
  asyncAcceptTurnFailedTitle: string;
  asyncApprovalDecisionFailedTitle: string;
  asyncSubmitUserInputFailedTitle: string;
  asyncPreviewMergeFailedTitle: string;
  asyncCancelMergeReviewFailedTitle: string;
  asyncStartMergeReviewFailedTitle: string;
  asyncRetryMergeFileFailedTitle: string;
  asyncBatchRetryMergeFailedTitle: string;
  asyncJumpSnapshotFailedTitle: string;
  asyncAcceptAllMergeFailedTitle: string;
  asyncAgentTakeoverFailedTitle: string;
  asyncCommitMergeFailedTitle: string;
  asyncDeleteThreadFailedTitle: string;
  asyncSearchUsersFailedTitle: string;
  asyncInstallSkillFailedTitle: string;
  asyncSwitchThreadFailedTitle: string;
  asyncSwitchToMainFailedTitle: string;
}

const zhCN: FeishuCardHandlerStrings = {
  skillUploadTimeout: "Skill 文件安装已超时取消：等待上传文件超过 10 分钟。",
  skillUploadWaiting: "已开始等待文件上传：请在当前会话发送一个 zip / tgz Skill 压缩包；文件下载后还需你手动确认安装，10 分钟内未上传会自动取消。",
  noPendingSkillInstall: "没有待确认的 Skill 文件安装任务，可能已过期。",
  skillInstallCanceled: "已取消 Skill 文件安装。",
  threadCreated: (threadName, backendId, model, threadIdPrefix) => `✅ Thread **${threadName}** 创建成功 (${backendId}/${model})\n🆔 ${threadIdPrefix}`,
  creatingThreadTitle: (threadName) => `⏳ 正在创建 Thread: ${threadName}`,
  creatingThreadBody: (backendId) => `正在启动 **${backendId}** 后端并建立会话，请稍候…`,
  creatingThreadFailedTitle: (threadName) => `❌ Thread 创建失败: ${threadName}`,
  creatingThreadFailedBody: (message) => `创建失败：${message}`,
  approvalApproved: "✅ 已批准",
  approvalRejected: "❌ 已拒绝",
  approvalApprovedOnce: "✅ 已批准（本次会话）",
  approvalTitleFileChange: "文件变更审批",
  approvalTitleCommand: "命令审批",
  approvalTypeFileChange: "文件改动",
  approvalTypeCommand: "命令执行",
  approvalThreadNameTitle: "**Thread 名称**",
  approvalSummaryTitle: "**审批摘要**",
  approvalResultTitle: "**处理结果**",
  approvalOperationTitle: "**操作对象**",
  approvalCommandTitleText: "**命令**",
  approvalReasonTitle: "**审批原因**",
  approvalStatusReasonTitle: "**状态说明**",
  approvalWorkingDirectoryTitle: "**工作目录**",
  approvalFilesTitle: "**涉及文件**",
  approvalMoreFiles: (count) => `另有 ${count} 个文件`,
  approvalHandledAt: (time) => `处理时间：${time}`,
  approvalHandledNote: "审批已处理，卡片元信息已保留，后续可结合日志继续追踪。",
  approvalExpiredTitle: "审批已失效",
  approvalExpiredBody: "当前 turn 已中断，此审批请求已失效。",
  approvalDuplicateTitle: "该审批已被处理",
  approvalDuplicateBody: "此审批请求已被其他用户处理，无需重复操作。",
  approvalInvalidTitle: "审批不存在",
  approvalInvalidBody: "未找到对应审批记录，可能该卡片已过旧或审批记录已被清理。",
  mergeCanceledTitle: (branchName) => `⏹️ 已取消合并: ${branchName}`,
  mergeReviewCanceledTitle: (branchName) => `⏹️ 已取消合并审阅: ${branchName}`,
  branchUnchanged: "分支保持不变",
  mergeCanceledBody: (branchName, baseBranch = "main") => `已取消 **${branchName}** → ${baseBranch} 的合并操作`,
  mergeReviewCanceledBody: (branchName, baseBranch = "main") => `已取消 **${branchName}** → ${baseBranch} 的合并审阅`,
  backToMergePanel: "返回 merge 面板",
  feishuFileSourceLabel: "Feishu 文件",
  skillInstallExpiresHint: "10 分钟内确认，否则自动取消",
  invalidSkillName: "Skill 名称不合法",
  localSkillImportUnavailable: "当前服务未启用本地 Skill 导入",
  skillNameValidationUnavailable: "当前服务未启用 Skill 名称校验",
  githubSubpathOnly: "当前仅支持 GitHub + 子路径安装",
  githubSubpathRequired: "GitHub 安装必须填写 skill 子路径",
  githubSubpathImportUnavailable: "当前服务未启用 GitHub+子路径导入",
  installTaskDownloading: "下载中，请稍候…",
  installTaskDownloaded: "下载完成",
  skillInstallCompleted: (fileName) => `Skill 文件安装完成：${fileName}`,
  skillInstallFailed: (message) => `Skill 文件安装失败：${message}`,
  planSelectionSubmittedTitle: "计划模式 · 选择已提交",
  planSelectionSubmittedTag: "已提交",
  planModeTag: "Plan 模式",
  planSelectionSubmitted: (actorId, timeStr) => `✅ 已提交选择  ·  <at id=${actorId}></at>  ·  ${timeStr}`,
  alignBackProjectManagement: "返回项目管理",
  alignSave: "保存",
  turnDetailMissing: "缺少 TurnDetail 持久化记录",
  turnRecordMissing: "未找到 TurnRecord",
  turnRecoveryFailed: (label, turnId, projectId, chatId) => `历史 Turn 恢复失败：${label}。请排查 turnId=${turnId} projectId=${projectId} chatId=${chatId}`,
  invalidPathChars: "路径包含非法字符",
  relativePathRequired: "请输入相对路径，不允许以 / 开头",
  pathEmpty: "路径不能为空",
  pathParentNotAllowed: "路径不允许包含 ..",
  pathWhitelistError: "路径包含非法字符，仅允许字母、数字、中文、下划线、短横线、点和斜杠",
  pathTooLong: "路径过长，最多 200 字符",
  snapshotContextReset: (turnIndex) => `⚠️ 跳转已重置对话上下文。文件已恢复到 **#${turnIndex}**，但 AI 不记得之前的对话历史。`,
  submitUserInputFailed: (message) => `⚠️ 提交用户输入失败: ${message}`,
  mergeRetrying: (filePath) => `🔄 Agent 正在根据反馈重新处理 \`${filePath}\`…`,
  enablePluginNoProject: "⚠️ 当前会话未绑定项目，无法启用插件",
  genericError: (message) => `❌ ${message}`,
  asyncProgressHint: "_请稍候，完成后会自动刷新结果。_",
  asyncInProgressTag: "处理中",
  asyncFailedTag: "失败",
  asyncPushTitle: "正在推送到 Remote",
  asyncPushBody: (branchName) => `正在执行 \`git push origin ${branchName}\`。`,
  asyncRevertTurnTitle: "正在回滚 Turn",
  asyncRevertTurnBody: (turnId) => `正在恢复 turn **${turnId}** 的文件与会话状态。`,
  asyncAcceptTurnTitle: "正在确认 Turn",
  asyncAcceptTurnBody: (turnId) => `正在确认 turn **${turnId}** 的变更。`,
  asyncApprovalDecisionTitle: "正在处理审批",
  asyncApprovalDecisionBody: (decision) => `正在提交审批动作：**${decision}**。`,
  asyncSubmitUserInputTitle: "正在提交用户输入",
  asyncSubmitUserInputBody: "正在将表单答案提交给 Agent。",
  asyncEnableSkillTitle: "正在启用 Skill",
  asyncEnableSkillBody: (skillName) => `正在启用 **${skillName}**。`,
  asyncRunMergeTitle: "正在执行合并",
  asyncRunMergeBody: (branchName) => `正在处理分支 **${branchName}** 的 merge。`,
  asyncPreviewMergeTitle: "正在预览合并",
  asyncPreviewMergeBody: (branchName) => `正在检查分支 **${branchName}** 的 merge 结果。`,
  asyncCancelMergeReviewTitle: "正在取消合并审阅",
  asyncCancelMergeReviewBody: (branchName) => `正在中止并清理 **${branchName}** 的 merge review。`,
  asyncStartMergeReviewTitle: "正在启动合并审阅",
  asyncStartMergeReviewBody: (branchName) => `正在为 **${branchName}** 建立 merge review 会话。`,
  asyncRetryMergeFileTitle: "正在请求 Agent 重试",
  asyncRetryMergeFileBody: (filePath) => `正在让 Agent 重新处理 \`${filePath}\`。`,
  asyncBatchRetryMergeTitle: "正在批量请求 Agent 重试",
  asyncBatchRetryMergeBody: (count) => `正在让 Agent 批量重新处理 **${count}** 个文件。`,
  asyncJumpSnapshotTitle: "正在跳转版本",
  asyncJumpSnapshotBody: (turnId) => `正在恢复到 turn **${turnId}** 对应的版本。`,
  asyncAcceptAllMergeTitle: "正在批量接受文件",
  asyncAcceptAllMergeBody: (branchName) => `正在批量接受分支 **${branchName}** 中剩余可直接通过的文件。`,
  asyncAgentTakeoverTitle: "正在启动 Agent 接管",
  asyncAgentTakeoverBody: (branchName) => `正在让 Agent 接管 **${branchName}** 的剩余冲突文件。`,
  asyncCommitMergeTitle: "正在提交合并结果",
  asyncCommitMergeBody: (branchName) => `正在提交 **${branchName}** 的 merge review 结果。`,
  asyncDeleteThreadTitle: "正在删除 Thread",
  asyncDeleteThreadBody: (threadName) => `正在删除 **${threadName}** 的 worktree 与线程记录。`,
  asyncSearchUsersTitle: "正在搜索用户",
  asyncSearchUsersBody: (keyword) => `正在搜索包含 **${keyword}** 的用户。`,
  asyncInstallSkillTitle: "正在安装 Skill",
  asyncInstallSkillBody: "正在校验并安装上传的 Skill 文件。",
  asyncSwitchThreadTitle: "正在切换 Thread",
  asyncSwitchThreadBody: (threadName) => `正在切换到 **${threadName}**，完成后会自动刷新线程卡片。`,
  asyncSwitchToMainTitle: "正在切回主会话",
  asyncSwitchToMainBody: "正在解绑当前 Thread，完成后会自动刷新线程卡片。",
  asyncRevertTurnFailedTitle: "回滚 Turn 失败",
  asyncAcceptTurnFailedTitle: "确认 Turn 失败",
  asyncApprovalDecisionFailedTitle: "审批处理失败",
  asyncSubmitUserInputFailedTitle: "提交用户输入失败",
  asyncPreviewMergeFailedTitle: "预览合并失败",
  asyncCancelMergeReviewFailedTitle: "取消合并审阅失败",
  asyncStartMergeReviewFailedTitle: "启动合并审阅失败",
  asyncRetryMergeFileFailedTitle: "Agent 重试启动失败",
  asyncBatchRetryMergeFailedTitle: "批量 Agent 重试启动失败",
  asyncJumpSnapshotFailedTitle: "跳转版本失败",
  asyncAcceptAllMergeFailedTitle: "批量接受失败",
  asyncAgentTakeoverFailedTitle: "启动 Agent 接管失败",
  asyncCommitMergeFailedTitle: "提交合并失败",
  asyncDeleteThreadFailedTitle: "删除 Thread 失败",
  asyncSearchUsersFailedTitle: "搜索用户失败",
  asyncInstallSkillFailedTitle: "Skill 安装失败",
  asyncSwitchThreadFailedTitle: "切换 Thread 失败",
  asyncSwitchToMainFailedTitle: "切回主会话失败",
};

const enUS: FeishuCardHandlerStrings = {
  skillUploadTimeout: "Skill file installation timed out: waited more than 10 minutes for upload.",
  skillUploadWaiting: "Waiting for file upload has started: send a zip / tgz skill archive in this chat. After download, you still need to confirm installation manually. If no file is uploaded within 10 minutes, it will be canceled automatically.",
  noPendingSkillInstall: "There is no pending skill file installation to confirm. It may have expired.",
  skillInstallCanceled: "Skill file installation was canceled.",
  threadCreated: (threadName, backendId, model, threadIdPrefix) => `✅ Thread **${threadName}** created (${backendId}/${model})\n🆔 ${threadIdPrefix}`,
  creatingThreadTitle: (threadName) => `⏳ Creating thread: ${threadName}`,
  creatingThreadBody: (backendId) => `Starting the **${backendId}** backend and establishing a session. Please wait…`,
  creatingThreadFailedTitle: (threadName) => `❌ Thread creation failed: ${threadName}`,
  creatingThreadFailedBody: (message) => `Creation failed: ${message}`,
  approvalApproved: "✅ Approved",
  approvalRejected: "❌ Rejected",
  approvalApprovedOnce: "✅ Approved (this session)",
  approvalTitleFileChange: "File change approval",
  approvalTitleCommand: "Command approval",
  approvalTypeFileChange: "File changes",
  approvalTypeCommand: "Command execution",
  approvalThreadNameTitle: "**Thread name**",
  approvalSummaryTitle: "**Approval summary**",
  approvalResultTitle: "**Result**",
  approvalOperationTitle: "**Operation**",
  approvalCommandTitleText: "**Command**",
  approvalReasonTitle: "**Reason**",
  approvalStatusReasonTitle: "**Status detail**",
  approvalWorkingDirectoryTitle: "**Working directory**",
  approvalFilesTitle: "**Files**",
  approvalMoreFiles: (count) => `${count} more file(s)`,
  approvalHandledAt: (time) => `Handled at: ${time}`,
  approvalHandledNote: "This approval has been processed. Card metadata is preserved for later tracing with logs.",
  approvalExpiredTitle: "Approval expired",
  approvalExpiredBody: "The current turn was interrupted, so this approval request is no longer valid.",
  approvalDuplicateTitle: "Approval already processed",
  approvalDuplicateBody: "This approval request has already been handled by another user. No further action is needed.",
  approvalInvalidTitle: "Approval not found",
  approvalInvalidBody: "No matching approval record was found. The card may be stale or the approval may already have been cleaned up.",
  mergeCanceledTitle: (branchName) => `⏹️ Merge canceled: ${branchName}`,
  mergeReviewCanceledTitle: (branchName) => `⏹️ Merge review canceled: ${branchName}`,
  branchUnchanged: "Branch remains unchanged",
  mergeCanceledBody: (branchName, baseBranch = "main") => `Canceled merge from **${branchName}** → ${baseBranch}`,
  mergeReviewCanceledBody: (branchName, baseBranch = "main") => `Canceled merge review from **${branchName}** → ${baseBranch}`,
  backToMergePanel: "Back to merge panel",
  feishuFileSourceLabel: "Feishu file",
  skillInstallExpiresHint: "Confirm within 10 minutes, or it will be canceled automatically",
  invalidSkillName: "Invalid skill name",
  localSkillImportUnavailable: "Local skill import is not enabled on this service",
  skillNameValidationUnavailable: "Skill name validation is not enabled on this service",
  githubSubpathOnly: "Only GitHub + subpath installation is supported right now",
  githubSubpathRequired: "GitHub installation requires a skill subpath",
  githubSubpathImportUnavailable: "GitHub + subpath import is not enabled on this service",
  installTaskDownloading: "Downloading, please wait…",
  installTaskDownloaded: "Download completed",
  skillInstallCompleted: (fileName) => `Skill file installation completed: ${fileName}`,
  skillInstallFailed: (message) => `Skill file installation failed: ${message}`,
  planSelectionSubmittedTitle: "Plan mode · selection submitted",
  planSelectionSubmittedTag: "Submitted",
  planModeTag: "Plan mode",
  planSelectionSubmitted: (actorId, timeStr) => `✅ Selection submitted  ·  <at id=${actorId}></at>  ·  ${timeStr}`,
  alignBackProjectManagement: "Back to project management",
  alignSave: "Save",
  turnDetailMissing: "Missing persisted TurnDetail record",
  turnRecordMissing: "TurnRecord not found",
  turnRecoveryFailed: (label, turnId, projectId, chatId) => `Failed to recover historical turn: ${label}. Check turnId=${turnId} projectId=${projectId} chatId=${chatId}`,
  invalidPathChars: "The path contains invalid characters",
  relativePathRequired: "Please enter a relative path; paths starting with / are not allowed",
  pathEmpty: "The path cannot be empty",
  pathParentNotAllowed: "The path cannot contain ..",
  pathWhitelistError: "The path contains invalid characters. Only letters, numbers, Chinese characters, underscores, hyphens, dots, and slashes are allowed",
  pathTooLong: "The path is too long. Maximum 200 characters",
  snapshotContextReset: (turnIndex) => `⚠️ Jumping reset the conversation context. Files were restored to **#${turnIndex}**, but the AI no longer remembers the previous conversation history.`,
  submitUserInputFailed: (message) => `⚠️ Failed to submit user input: ${message}`,
  mergeRetrying: (filePath) => `🔄 Agent is reprocessing \`${filePath}\` based on your feedback…`,
  enablePluginNoProject: "⚠️ The current session is not bound to a project, so the plugin cannot be enabled",
  genericError: (message) => `❌ ${message}`,
  asyncProgressHint: "_Please wait. The result card will refresh automatically when finished._",
  asyncInProgressTag: "In progress",
  asyncFailedTag: "Failed",
  asyncPushTitle: "Pushing to remote",
  asyncPushBody: (branchName) => `Running \`git push origin ${branchName}\`.`,
  asyncRevertTurnTitle: "Reverting turn",
  asyncRevertTurnBody: (turnId) => `Restoring files and session state for turn **${turnId}**.`,
  asyncAcceptTurnTitle: "Accepting turn",
  asyncAcceptTurnBody: (turnId) => `Accepting changes for turn **${turnId}**.`,
  asyncApprovalDecisionTitle: "Processing approval",
  asyncApprovalDecisionBody: (decision) => `Submitting approval decision: **${decision}**.`,
  asyncSubmitUserInputTitle: "Submitting user input",
  asyncSubmitUserInputBody: "Submitting the form answers to the agent.",
  asyncEnableSkillTitle: "Enabling skill",
  asyncEnableSkillBody: (skillName) => `Enabling **${skillName}**.`,
  asyncRunMergeTitle: "Running merge",
  asyncRunMergeBody: (branchName) => `Processing merge for branch **${branchName}**.`,
  asyncPreviewMergeTitle: "Previewing merge",
  asyncPreviewMergeBody: (branchName) => `Checking the merge result for branch **${branchName}**.`,
  asyncCancelMergeReviewTitle: "Canceling merge review",
  asyncCancelMergeReviewBody: (branchName) => `Stopping and cleaning up merge review for **${branchName}**.`,
  asyncStartMergeReviewTitle: "Starting merge review",
  asyncStartMergeReviewBody: (branchName) => `Creating a merge review session for **${branchName}**.`,
  asyncRetryMergeFileTitle: "Requesting agent retry",
  asyncRetryMergeFileBody: (filePath) => `Requesting the agent to reprocess \`${filePath}\`.`,
  asyncBatchRetryMergeTitle: "Starting batch agent retry",
  asyncBatchRetryMergeBody: (count) => `Requesting the agent to retry **${count}** file(s) in batch.`,
  asyncJumpSnapshotTitle: "Jumping to snapshot",
  asyncJumpSnapshotBody: (turnId) => `Restoring the version for turn **${turnId}**.`,
  asyncAcceptAllMergeTitle: "Accepting remaining files",
  asyncAcceptAllMergeBody: (branchName) => `Accepting remaining directly reviewable files in **${branchName}**.`,
  asyncAgentTakeoverTitle: "Starting agent takeover",
  asyncAgentTakeoverBody: (branchName) => `Starting agent takeover for remaining conflict files in **${branchName}**.`,
  asyncCommitMergeTitle: "Committing merge result",
  asyncCommitMergeBody: (branchName) => `Committing merge review result for **${branchName}**.`,
  asyncDeleteThreadTitle: "Deleting thread",
  asyncDeleteThreadBody: (threadName) => `Deleting the worktree and thread record for **${threadName}**.`,
  asyncSearchUsersTitle: "Searching users",
  asyncSearchUsersBody: (keyword) => `Searching users matching **${keyword}**.`,
  asyncInstallSkillTitle: "Installing skill",
  asyncInstallSkillBody: "Validating and installing the uploaded skill.",
  asyncSwitchThreadTitle: "Switching thread",
  asyncSwitchThreadBody: (threadName) => `Switching to **${threadName}**. The thread card will refresh automatically when finished.`,
  asyncSwitchToMainTitle: "Switching to main session",
  asyncSwitchToMainBody: "Clearing the current thread binding. The thread card will refresh automatically when finished.",
  asyncRevertTurnFailedTitle: "Failed to revert turn",
  asyncAcceptTurnFailedTitle: "Failed to accept turn",
  asyncApprovalDecisionFailedTitle: "Failed to process approval",
  asyncSubmitUserInputFailedTitle: "Failed to submit user input",
  asyncPreviewMergeFailedTitle: "Failed to preview merge",
  asyncCancelMergeReviewFailedTitle: "Failed to cancel merge review",
  asyncStartMergeReviewFailedTitle: "Failed to start merge review",
  asyncRetryMergeFileFailedTitle: "Failed to start agent retry",
  asyncBatchRetryMergeFailedTitle: "Failed to start batch agent retry",
  asyncJumpSnapshotFailedTitle: "Failed to jump to snapshot",
  asyncAcceptAllMergeFailedTitle: "Failed to accept remaining files",
  asyncAgentTakeoverFailedTitle: "Failed to start agent takeover",
  asyncCommitMergeFailedTitle: "Failed to commit merge review",
  asyncDeleteThreadFailedTitle: "Failed to delete thread",
  asyncSearchUsersFailedTitle: "Failed to search users",
  asyncInstallSkillFailedTitle: "Skill installation failed",
  asyncSwitchThreadFailedTitle: "Failed to switch thread",
  asyncSwitchToMainFailedTitle: "Failed to switch to main session",
};

export function getFeishuCardHandlerStrings(locale: AppLocale): FeishuCardHandlerStrings {
  return locale === "en-US" ? enUS : zhCN;
}
