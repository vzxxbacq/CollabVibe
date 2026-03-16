import type { AppLocale } from "../../packages/channel-core/src/app-locale";

export interface FeishuCardHandlerStrings {
  skillUploadTimeout: string;
  skillUploadWaiting: string;
  noPendingSkillInstall: string;
  skillInstallCanceled: string;
  threadCreated(threadName: string, backendId: string, model: string, threadIdPrefix: string): string;
  creatingThreadTitle(threadName: string): string;
  creatingThreadBody(backendId: string): string;
  approvalApproved: string;
  approvalRejected: string;
  approvalApprovedOnce: string;
  approvalTitleFileChange: string;
  approvalTitleCommand: string;
  approvalTypeFileChange: string;
  approvalTypeCommand: string;
  approvalSummaryTitle: string;
  approvalResultTitle: string;
  approvalHandledAt(time: string): string;
  approvalHandledNote: string;
  mergeCanceledTitle(branchName: string): string;
  mergeReviewCanceledTitle(branchName: string): string;
  branchUnchanged: string;
  mergeCanceledBody(branchName: string): string;
  mergeReviewCanceledBody(branchName: string): string;
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
}

const zhCN: FeishuCardHandlerStrings = {
  skillUploadTimeout: "Skill 文件安装已超时取消：等待上传文件超过 10 分钟。",
  skillUploadWaiting: "已开始等待文件上传：请在当前会话发送一个 zip / tgz Skill 压缩包；文件下载后还需你手动确认安装，10 分钟内未上传会自动取消。",
  noPendingSkillInstall: "没有待确认的 Skill 文件安装任务，可能已过期。",
  skillInstallCanceled: "已取消 Skill 文件安装。",
  threadCreated: (threadName, backendId, model, threadIdPrefix) => `✅ Thread **${threadName}** 创建成功 (${backendId}/${model})\n🆔 ${threadIdPrefix}`,
  creatingThreadTitle: (threadName) => `⏳ 正在创建 Thread: ${threadName}`,
  creatingThreadBody: (backendId) => `正在启动 **${backendId}** 后端并建立会话，请稍候…`,
  approvalApproved: "✅ 已批准",
  approvalRejected: "❌ 已拒绝",
  approvalApprovedOnce: "✅ 已批准（本次会话）",
  approvalTitleFileChange: "文件变更审批",
  approvalTitleCommand: "命令审批",
  approvalTypeFileChange: "文件改动",
  approvalTypeCommand: "命令执行",
  approvalSummaryTitle: "**审批摘要**",
  approvalResultTitle: "**处理结果**",
  approvalHandledAt: (time) => `处理时间：${time}`,
  approvalHandledNote: "审批已处理，卡片元信息已保留，后续可结合日志继续追踪。",
  mergeCanceledTitle: (branchName) => `⏹️ 已取消合并: ${branchName}`,
  mergeReviewCanceledTitle: (branchName) => `⏹️ 已取消合并审阅: ${branchName}`,
  branchUnchanged: "分支保持不变",
  mergeCanceledBody: (branchName) => `已取消 **${branchName}** → main 的合并操作`,
  mergeReviewCanceledBody: (branchName) => `已取消 **${branchName}** → main 的合并审阅`,
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
};

const enUS: FeishuCardHandlerStrings = {
  skillUploadTimeout: "Skill file installation timed out: waited more than 10 minutes for upload.",
  skillUploadWaiting: "Waiting for file upload has started: send a zip / tgz skill archive in this chat. After download, you still need to confirm installation manually. If no file is uploaded within 10 minutes, it will be canceled automatically.",
  noPendingSkillInstall: "There is no pending skill file installation to confirm. It may have expired.",
  skillInstallCanceled: "Skill file installation was canceled.",
  threadCreated: (threadName, backendId, model, threadIdPrefix) => `✅ Thread **${threadName}** created (${backendId}/${model})\n🆔 ${threadIdPrefix}`,
  creatingThreadTitle: (threadName) => `⏳ Creating thread: ${threadName}`,
  creatingThreadBody: (backendId) => `Starting the **${backendId}** backend and establishing a session. Please wait…`,
  approvalApproved: "✅ Approved",
  approvalRejected: "❌ Rejected",
  approvalApprovedOnce: "✅ Approved (this session)",
  approvalTitleFileChange: "File change approval",
  approvalTitleCommand: "Command approval",
  approvalTypeFileChange: "File changes",
  approvalTypeCommand: "Command execution",
  approvalSummaryTitle: "**Approval summary**",
  approvalResultTitle: "**Result**",
  approvalHandledAt: (time) => `Handled at: ${time}`,
  approvalHandledNote: "This approval has been processed. Card metadata is preserved for later tracing with logs.",
  mergeCanceledTitle: (branchName) => `⏹️ Merge canceled: ${branchName}`,
  mergeReviewCanceledTitle: (branchName) => `⏹️ Merge review canceled: ${branchName}`,
  branchUnchanged: "Branch remains unchanged",
  mergeCanceledBody: (branchName) => `Canceled merge from **${branchName}** → main`,
  mergeReviewCanceledBody: (branchName) => `Canceled merge review from **${branchName}** → main`,
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
};

export function getFeishuCardHandlerStrings(locale: AppLocale): FeishuCardHandlerStrings {
  return locale === "en-US" ? enUS : zhCN;
}
