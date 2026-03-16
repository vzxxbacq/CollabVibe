import type { AppLocale } from "../../channel-core/src/app-locale";

export interface FeishuOutputAdapterStrings {
  threadLabel(threadLabel: string): string;
  threadCodeLabel(threadLabel: string): string;
  approvalSubtitle(threadLabel: string, createdAtLabel: string): string;
  turnLabel(turnId: string): string;
  emptyThreadList: string;
  threadCreated(threadName: string, threadIdShort: string): string;
  threadSwitched(threadName: string): string;
  threadLeft: string;
  snapshotEmpty: string;
  snapshotJumped(turnIndex: number, agentSummary: string, contextReset: boolean): string;
  modelSet(currentModel: string): string;
  mergeRejected(branchName: string): string;
  skillRemoved(skillName: string): string;
  skillAdminPlaceholder: string;
  skillError(message: string): string;
  approvalCommandTitle: string;
  approvalPatchTitle: string;
  approvalCommandType: string;
  approvalPatchType: string;
  approvalFilesAffected(count: number): string;
  approvalCreatedAt: string;
  approvalType: string;
  approvalPendingSummary: string;
  approvalFilesTitle: string;
  approvalMoreFiles(count: number): string;
  approvalCommandDetails: string;
  approvalApprove: string;
  approvalDeny: string;
  approvalApproveAlways: string;
  approvalAlwaysTip: string;
  approvalCheckTip: string;
  approvalPendingTag: string;
  currentThreadLabel: string;
  questionCount(count: number): string;
  interactionPlanConfirm: string;
  questionTitle(index: number): string;
  choosePlease: string;
  chooseRecommendedTip: string;
  submitConfirm: string;
  submitPlanTip: string;
  planModeNeedChoice: string;
  pendingConfirm: string;
  planModeTag: string;
  skillFormEmpty: string;
  skillNoDescription: string;
  skillSelectPlaceholder: string;
  skillInstallButton: string;
  skillCardTitle: string;
  skillInstalledCount(installed: number, total: number): string;
  skillInstallSuccess(name: string): string;
  approvalFileChangeDefaultDescription: string;
}

const zhCN: FeishuOutputAdapterStrings = {
  threadLabel: (threadLabel) => `**Thread**  **${threadLabel}**`,
  threadCodeLabel: (threadLabel) => `**Thread**  \`${threadLabel}\``,
  approvalSubtitle: (threadLabel, createdAtLabel) => `Thread Name: ${threadLabel} · ${createdAtLabel}`,
  turnLabel: (turnId) => `**Turn**  \`${turnId}\``,
  emptyThreadList: "📋 暂无线程，@bot 打开面板创建",
  threadCreated: (threadName, threadIdShort) => `✅ 线程已创建: **${threadName}**\nID: \`${threadIdShort}\``,
  threadSwitched: (threadName) => `🔄 已切换到: **${threadName}**`,
  threadLeft: "👋 已退出当前线程",
  snapshotEmpty: "📜 暂无历史快照。发送消息后自动创建",
  snapshotJumped: (turnIndex, agentSummary, contextReset) =>
    `🔄 已跳转到 **#${turnIndex}** ${agentSummary}${contextReset ? "\n\n⚠️ 跳转已重置对话上下文。文件已恢复，但 AI 不记得之前的对话历史。" : ""}`,
  modelSet: (currentModel) => `✅ 模型已切换为 **${currentModel}**`,
  mergeRejected: (branchName) => `合并 **${branchName}** 已取消`,
  skillRemoved: (skillName) => `🗑️ Skill **${skillName}** 已移除`,
  skillAdminPlaceholder: "⚙️ Skill 管理员功能开发中，敬请期待",
  skillError: (message) => `❌ Skill 操作失败: ${message}`,
  approvalCommandTitle: "命令审批",
  approvalPatchTitle: "文件变更审批",
  approvalCommandType: "命令执行",
  approvalPatchType: "文件改动",
  approvalFilesAffected: (count) => `涉及 ${count} 个文件`,
  approvalCreatedAt: "创建时间",
  approvalType: "审批类型",
  approvalPendingSummary: "待审批摘要",
  approvalFilesTitle: "涉及文件",
  approvalMoreFiles: (count) => `另外 ${count} 个文件`,
  approvalCommandDetails: "命令详情",
  approvalApprove: "批准",
  approvalDeny: "拒绝",
  approvalApproveAlways: "始终批准",
  approvalAlwaysTip: "始终批准会对同类操作持续放行，请仅在确认风险可接受时使用。",
  approvalCheckTip: "请确认 Thread 与操作内容后再审批。",
  approvalPendingTag: "待审批",
  currentThreadLabel: "当前 Thread",
  questionCount: (count) => `问题数  ${count}`,
  interactionPlanConfirm: "交互类型  计划确认",
  questionTitle: (index) => `问题 ${index}`,
  choosePlease: "请选择",
  chooseRecommendedTip: "请选择最符合当前计划意图的选项；推荐项已默认选中。",
  submitConfirm: "确认提交",
  submitPlanTip: "提交后会继续当前 Plan 流程；如需修改，可重新触发计划交互。",
  planModeNeedChoice: "计划模式 · 需要你的选择",
  pendingConfirm: "待确认",
  planModeTag: "Plan 模式",
  skillFormEmpty: "暂无可用 Skill。请联系管理员通过 `/skill admin` 添加。",
  skillNoDescription: "无描述",
  skillSelectPlaceholder: "选择要安装的 Skill",
  skillInstallButton: "📥 安装",
  skillCardTitle: "🧩 Skills",
  skillInstalledCount: (installed, total) => `${installed}/${total} 已安装`,
  skillInstallSuccess: (name) => `✅ Skill 安装成功: ${name}`,
  approvalFileChangeDefaultDescription: "审批文件变更",
};

const enUS: FeishuOutputAdapterStrings = {
  threadLabel: (threadLabel) => `**Thread**  **${threadLabel}**`,
  threadCodeLabel: (threadLabel) => `**Thread**  \`${threadLabel}\``,
  approvalSubtitle: (threadLabel, createdAtLabel) => `Thread Name: ${threadLabel} · ${createdAtLabel}`,
  turnLabel: (turnId) => `**Turn**  \`${turnId}\``,
  emptyThreadList: "📋 No threads yet. Mention @bot to open the panel and create one.",
  threadCreated: (threadName, threadIdShort) => `✅ Thread created: **${threadName}**\nID: \`${threadIdShort}\``,
  threadSwitched: (threadName) => `🔄 Switched to: **${threadName}**`,
  threadLeft: "👋 Left the current thread",
  snapshotEmpty: "📜 No snapshots yet. A snapshot will be created after a message is sent.",
  snapshotJumped: (turnIndex, agentSummary, contextReset) =>
    `🔄 Jumped to **#${turnIndex}** ${agentSummary}${contextReset ? "\n\n⚠️ The jump reset the conversation context. Files were restored, but the AI no longer remembers the earlier conversation." : ""}`,
  modelSet: (currentModel) => `✅ Model switched to **${currentModel}**`,
  mergeRejected: (branchName) => `Merge for **${branchName}** was cancelled`,
  skillRemoved: (skillName) => `🗑️ Removed skill **${skillName}**`,
  skillAdminPlaceholder: "⚙️ Skill admin features are still under development",
  skillError: (message) => `❌ Skill operation failed: ${message}`,
  approvalCommandTitle: "Command approval",
  approvalPatchTitle: "File change approval",
  approvalCommandType: "Command execution",
  approvalPatchType: "File changes",
  approvalFilesAffected: (count) => `${count} files affected`,
  approvalCreatedAt: "Created at",
  approvalType: "Approval type",
  approvalPendingSummary: "Pending summary",
  approvalFilesTitle: "Files involved",
  approvalMoreFiles: (count) => `${count} more files`,
  approvalCommandDetails: "Command details",
  approvalApprove: "Approve",
  approvalDeny: "Deny",
  approvalApproveAlways: "Always approve",
  approvalAlwaysTip: "Always approve will continue allowing similar operations. Use it only if the risk is acceptable.",
  approvalCheckTip: "Confirm the thread and operation details before approving.",
  approvalPendingTag: "Pending",
  currentThreadLabel: "Current thread",
  questionCount: (count) => `Questions  ${count}`,
  interactionPlanConfirm: "Interaction  Plan confirmation",
  questionTitle: (index) => `Question ${index}`,
  choosePlease: "Please choose",
  chooseRecommendedTip: "Choose the option that best matches the current plan intent; the recommended option is selected by default.",
  submitConfirm: "Submit",
  submitPlanTip: "Submitting will continue the current plan flow. To change it, trigger the plan interaction again.",
  planModeNeedChoice: "Plan mode · your choice is needed",
  pendingConfirm: "Pending",
  planModeTag: "Plan mode",
  skillFormEmpty: "No skills are available. Ask an administrator to add one via `/skill admin`.",
  skillNoDescription: "No description",
  skillSelectPlaceholder: "Choose a skill to install",
  skillInstallButton: "📥 Install",
  skillCardTitle: "🧩 Skills",
  skillInstalledCount: (installed, total) => `${installed}/${total} installed`,
  skillInstallSuccess: (name) => `✅ Skill installed: ${name}`,
  approvalFileChangeDefaultDescription: "Approve file changes",
};

export function getFeishuOutputAdapterStrings(locale: AppLocale): FeishuOutputAdapterStrings {
  return locale === "en-US" ? enUS : zhCN;
}
