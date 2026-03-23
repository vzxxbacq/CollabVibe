import { DEFAULT_APP_LOCALE, type AppLocale } from "../../common/app-locale";

export interface FeishuTurnCardStrings {
  running: string;
  failed: string;
  completed: string;
  statusAborted: string;
  statusFailed: string;
  statusRunningLabel: string;
  statusDoneLabel: string;
  statusAbortedLabel: string;
  statusFailedLabel: string;
  patchPrefix(targetFile: string): string;
  applyPatch: string;
  childAgentWorking(agentId: string): string;
  childAgentNote(note: string): string;
  planCompleted: string;
  planInProgress: string;
  planPending: string;
  planUpdated: string;
  threadNameLabel(name: string): string;
  footerDone(tokens: string, fileCount: number): string;
  footerAborted(reason: string, tokens?: string, fileCount?: number): string;
  footerFailed(reason: string, tokens?: string): string;
  done: string;
  fileChanges(count: number): string;
  statusDone: string;
  statusRunning: string;
  truncated: string;
  waitingOutput: string;
  thinkingProcess(label: string): string;
  executePlan: string;
  executeProcess(stepCount: number): string;
  clickViewDetails: string;
  fileModify(count: number, add: number, del: number): string;
  clickViewDiff: string;
  confirmStopTitle: string;
  confirmStopText: string;
  stopExecution: string;
  stopAgentTask: string;
  approveChanges: string;
  confirmRevertTitle: string;
  confirmRevertText: string;
  revertChanges: string;
  doneNoFileChanges: string;
  actionAccepted: string;
  actionReverted: string;
  actionInterrupting: string;
  actionInterrupted: string;
  actionProcessed: string;
  interruptRequestedBy(user: string): string;
  interruptedBy(user: string): string;
  interruptRequestedAt(time: string): string;
  interruptedAt(time: string): string;
  replyTitle: string;
  thinkingTitle: string;
  waitingThinking: string;
  toolsTitle: string;
  toolOutputSection: string;
  executionProgressSection: string;
  waitingToolOutput: string;
  progressTitle: string;
  waitingExecutionProgress: string;
  statusTitle: string;
  generating: string;
  generatingWithTokens(tokenText: string): string;
  actionsTitle: string;
  loadingActions: string;
  actionsAvailableAfterCompletion: string;
  agentMode: string;
  planMode: string;
  previousPage: string;
  nextPage: string;
  backToTurnCard: string;
  fileChangesTitle: string;
  executionProcessTitle: string;
  stepCount(stepCount: number): string;
}

const zhCN: FeishuTurnCardStrings = {
  running: "<font color='blue'>运行中</font>",
  failed: "<font color='red'>失败</font>",
  completed: "<font color='green'>完成</font>",
  statusAborted: "<font color='red'>中断</font>",
  statusFailed: "<font color='red'>失败</font>",
  statusRunningLabel: "运行中",
  statusDoneLabel: "已完成",
  statusAbortedLabel: "已中断",
  statusFailedLabel: "失败",
  patchPrefix: (targetFile) => `补丁: ${targetFile}`,
  applyPatch: "应用补丁",
  childAgentWorking: (agentId) => `子 agent-${agentId} 工作中`,
  childAgentNote: (note) => `子 ${note} 工作中`,
  planCompleted: "<font color='green'>已完成</font>",
  planInProgress: "<font color='blue'>进行中</font>",
  planPending: "<font color='grey'>待执行</font>",
  planUpdated: "计划已更新",
  threadNameLabel: (name) => `Thread Name: ${name}`,
  footerDone: (tokens, fileCount) => `✅ 完成 · ${tokens} tokens · ${fileCount} 文件`,
  footerAborted: (reason, tokens, fileCount) => [`⛔ 已中断`, reason, tokens ? `${tokens} tokens` : null, typeof fileCount === "number" ? `${fileCount} 文件` : null].filter(Boolean).join(" · "),
  footerFailed: (reason, tokens) => [`❌ 失败`, reason, tokens ? `${tokens} tokens` : null].filter(Boolean).join(" · "),
  done: "完成",
  fileChanges: (count) => `${count} 文件变更`,
  statusDone: "已完成",
  statusRunning: "运行中",
  truncated: "_...已截断_",
  waitingOutput: "等待输出...",
  thinkingProcess: (label) => `**思考过程** (${label})`,
  executePlan: "**执行计划**",
  executeProcess: (stepCount) => `**执行过程** (${stepCount} 步)`,
  clickViewDetails: "点击查看详情",
  fileModify: (count, add, del) => `**文件修改** (${count} file${count > 1 ? "s" : ""} +${add}/-${del})`,
  clickViewDiff: "点击查看 diff",
  confirmStopTitle: "确认停止？",
  confirmStopText: "将中断当前执行",
  stopExecution: "**停止执行**",
  stopAgentTask: "中断当前 Agent 任务",
  approveChanges: "**批准变更**",
  confirmRevertTitle: "确认撤销？",
  confirmRevertText: "将回滚本次所有文件变更",
  revertChanges: "**撤销变更**",
  doneNoFileChanges: "完成 (无文件修改)",
  actionAccepted: "已批准",
  actionReverted: "已撤销",
  actionInterrupting: "正在关闭中",
  actionInterrupted: "已中断",
  actionProcessed: "已处理",
  interruptRequestedBy: (user) => `中止请求人：${user}`,
  interruptedBy: (user) => `已由 ${user} 中止`,
  interruptRequestedAt: (time) => `请求时间：${time}`,
  interruptedAt: (time) => `中止时间：${time}`,
  replyTitle: "回复",
  thinkingTitle: "思考",
  waitingThinking: "等待思考输出...",
  toolsTitle: "工具",
  toolOutputSection: "工具输出",
  executionProgressSection: "执行过程",
  waitingToolOutput: "等待工具输出...",
  progressTitle: "进度",
  waitingExecutionProgress: "等待执行过程...",
  statusTitle: "状态",
  generating: "生成中...",
  generatingWithTokens: (tokenText) => `生成中 · ${tokenText} tokens`,
  actionsTitle: "操作",
  loadingActions: "已完成，正在加载操作项...",
  actionsAvailableAfterCompletion: "生成中，完成后可进行后续操作",
  agentMode: "Agent",
  planMode: "Plan",
  previousPage: "上一页",
  nextPage: "下一页",
  backToTurnCard: "**返回 Turn Card**",
  fileChangesTitle: "文件修改",
  executionProcessTitle: "执行过程",
  stepCount: (stepCount) => `${stepCount} 步`,
};

const enUS: FeishuTurnCardStrings = {
  running: "<font color='blue'>Running</font>",
  failed: "<font color='red'>Failed</font>",
  completed: "<font color='green'>Done</font>",
  statusAborted: "<font color='red'>Aborted</font>",
  statusFailed: "<font color='red'>Failed</font>",
  statusRunningLabel: "Running",
  statusDoneLabel: "Done",
  statusAbortedLabel: "Aborted",
  statusFailedLabel: "Failed",
  patchPrefix: (targetFile) => `Patch: ${targetFile}`,
  applyPatch: "Apply patch",
  childAgentWorking: (agentId) => `Child agent-${agentId} is running`,
  childAgentNote: (note) => `Child ${note} is running`,
  planCompleted: "<font color='green'>Completed</font>",
  planInProgress: "<font color='blue'>In progress</font>",
  planPending: "<font color='grey'>Pending</font>",
  planUpdated: "Plan updated",
  threadNameLabel: (name) => `Thread Name: ${name}`,
  footerDone: (tokens, fileCount) => `✅ Done · ${tokens} tokens · ${fileCount} files`,
  footerAborted: (reason, tokens, fileCount) => [`⛔ Aborted`, reason, tokens ? `${tokens} tokens` : null, typeof fileCount === "number" ? `${fileCount} files` : null].filter(Boolean).join(" · "),
  footerFailed: (reason, tokens) => [`❌ Failed`, reason, tokens ? `${tokens} tokens` : null].filter(Boolean).join(" · "),
  done: "Done",
  fileChanges: (count) => `${count} file changes`,
  statusDone: "Done",
  statusRunning: "Running",
  truncated: "_...truncated_",
  waitingOutput: "Waiting for output...",
  thinkingProcess: (label) => `**Thinking** (${label})`,
  executePlan: "**Execution plan**",
  executeProcess: (stepCount) => `**Execution process** (${stepCount} steps)`,
  clickViewDetails: "Click to view details",
  fileModify: (count, add, del) => `**File changes** (${count} file${count > 1 ? "s" : ""} +${add}/-${del})`,
  clickViewDiff: "Click to view diff",
  confirmStopTitle: "Stop execution?",
  confirmStopText: "This will interrupt the current run",
  stopExecution: "**Stop execution**",
  stopAgentTask: "Interrupt the current agent task",
  approveChanges: "**Approve changes**",
  confirmRevertTitle: "Revert changes?",
  confirmRevertText: "This will roll back all file changes from this run",
  revertChanges: "**Revert changes**",
  doneNoFileChanges: "Done (no file changes)",
  actionAccepted: "Approved",
  actionReverted: "Reverted",
  actionInterrupting: "Stopping...",
  actionInterrupted: "Interrupted",
  actionProcessed: "Processed",
  interruptRequestedBy: (user) => `Interrupt requested by: ${user}`,
  interruptedBy: (user) => `Interrupted by: ${user}`,
  interruptRequestedAt: (time) => `Requested at: ${time}`,
  interruptedAt: (time) => `Interrupted at: ${time}`,
  replyTitle: "Reply",
  thinkingTitle: "Thinking",
  waitingThinking: "Waiting for thinking output...",
  toolsTitle: "Tools",
  toolOutputSection: "Tool output",
  executionProgressSection: "Execution process",
  waitingToolOutput: "Waiting for tool output...",
  progressTitle: "Progress",
  waitingExecutionProgress: "Waiting for execution progress...",
  statusTitle: "Status",
  generating: "Generating...",
  generatingWithTokens: (tokenText) => `Generating · ${tokenText} tokens`,
  actionsTitle: "Actions",
  loadingActions: "Completed. Loading available actions...",
  actionsAvailableAfterCompletion: "Still generating. Actions will be available after completion",
  agentMode: "Agent",
  planMode: "Plan",
  previousPage: "Previous",
  nextPage: "Next",
  backToTurnCard: "**Back to Turn Card**",
  fileChangesTitle: "File changes",
  executionProcessTitle: "Execution process",
  stepCount: (stepCount) => `${stepCount} steps`,
};

export function getFeishuTurnCardStrings(locale: AppLocale = DEFAULT_APP_LOCALE): FeishuTurnCardStrings {
  return locale === "en-US" ? enUS : zhCN;
}
