import type { AppLocale } from "../common/app-locale";

export interface FeishuNotifyStrings {
  notYourCard: string;
  noPermission: string;
  pendingApproval(name: string): string;
  threadRunning(name: string): string;
  fallbackHelp: string;
  projectCreated(p: { name: string; id: string; cwd: string }): string;
  projectList(lines: string[]): string;
  noProjects: string;
  noThreads: string;
  snapshotEmptyThread(name: string): string;
  snapshotEmptyMerge: string;
  skillSourceMissing: string;
  genericError(msg: string): string;
  projectCreateError(msg: string): string;
  threadCreateError(msg: string): string;
  switchFailed(msg: string): string;
  jumpFailed(msg: string): string;
  mergePreviewError(msg: string): string;
  skillInstallError(msg: string): string;
  skillRemoveError(msg: string): string;
  pathValidationError(msg: string): string;
  orchestratorErrors: Record<string, string>;
}

const zhCN: FeishuNotifyStrings = {
  notYourCard: "⛔ 这不是你的卡片",
  noPermission: "⛔ 您没有权限执行此操作，请联系管理员",
  pendingApproval: (name) => `⚠️ Thread **${name}** 有未确认的文件修改，请先 ✅批准 或 ↩️撤销 后再发新任务`,
  threadRunning: (name) => `⏳ Thread **${name}** 正在运行中，请等待完成后再发送`,
  fallbackHelp: "💡 @bot 打开命令面板",
  projectCreated: (p) => `✅ 项目创建成功\n📦 名称: ${p.name}\n🆔 ID: ${p.id}\n📂 工作目录: ${p.cwd}\n👤 你已成为 maintainer`,
  projectList: (lines) => `📋 项目列表:\n${lines.join("\n")}`,
  noProjects: "📋 暂无项目，请在管理面板中创建",
  noThreads: "📋 暂无线程，@bot 打开面板创建",
  snapshotEmptyThread: (name) => `📭 线程 **${name}** 暂无快照历史`,
  snapshotEmptyMerge: "📭 暂无 merge 历史。合并线程后将自动记录",
  skillSourceMissing: "⚠️ 请输入 GitHub 仓库链接",
  genericError: (msg) => `❌ ${msg}`,
  projectCreateError: (msg) => msg.startsWith("此群已绑定项目") ? `⚠️ ${msg}` : `❌ 项目创建失败: ${msg}`,
  threadCreateError: (msg) => `❌ Thread 创建失败: ${msg}`,
  switchFailed: (msg) => `❌ 切换失败: ${msg}`,
  jumpFailed: (msg) => `❌ 跳转失败: ${msg}`,
  mergePreviewError: (msg) => `❌ 合并预览失败: ${msg}`,
  skillInstallError: (msg) => `❌ Skill 安装失败: ${msg}`,
  skillRemoveError: (msg) => `❌ Skill 卸载失败: ${msg}`,
  pathValidationError: (msg) => `❌ 路径校验失败: ${msg}`,
  orchestratorErrors: {
    TURN_ALREADY_RUNNING: "⏳ 当前线程正在运行中，请等待完成后再发送",
    APPROVAL_PENDING: "⚠️ 有未确认的文件修改，请先 ✅批准 或 ↩️撤销 后再发新任务",
    NO_ACTIVE_THREAD: "💡 请先 @bot 打开面板创建或加入线程",
    THREAD_NOT_FOUND: "❌ 线程不存在，请检查名称",
    THREAD_ALREADY_EXISTS: "⚠️ 该线程名称已存在，请选择其他名称",
    PROJECT_NOT_FOUND: "❌ 当前会话未绑定有效项目，请先初始化或重新绑定项目",
    AGENT_API_UNAVAILABLE: "❌ Agent 连接不可用，请稍后重试",
    TURN_BLOCKED_PENDING_APPROVAL: "⚠️ 有未确认的文件修改，请先 ✅批准 或 ↩️撤销 后再发新任务",
  }
};

const enUS: FeishuNotifyStrings = {
  notYourCard: "⛔ This card is not yours",
  noPermission: "⛔ You do not have permission to perform this action. Contact an administrator.",
  pendingApproval: (name) => `⚠️ Thread **${name}** has unconfirmed file changes. Approve or revert them before sending a new task.`,
  threadRunning: (name) => `⏳ Thread **${name}** is still running. Wait until it completes.`,
  fallbackHelp: "💡 Mention @bot to open the command panel",
  projectCreated: (p) => `✅ Project created successfully\n📦 Name: ${p.name}\n🆔 ID: ${p.id}\n📂 Workspace: ${p.cwd}\n👤 You are now a maintainer`,
  projectList: (lines) => `📋 Projects:\n${lines.join("\n")}`,
  noProjects: "📋 No projects yet. Create one from the admin panel.",
  noThreads: "📋 No threads yet. Mention @bot to open the panel and create one.",
  snapshotEmptyThread: (name) => `📭 Thread **${name}** has no snapshot history yet`,
  snapshotEmptyMerge: "📭 No merge history yet. It will be recorded after a thread merge.",
  skillSourceMissing: "⚠️ Please provide a GitHub repository URL",
  genericError: (msg) => `❌ ${msg}`,
  projectCreateError: (msg) => msg.startsWith("This chat is already bound") ? `⚠️ ${msg}` : `❌ Project creation failed: ${msg}`,
  threadCreateError: (msg) => `❌ Thread creation failed: ${msg}`,
  switchFailed: (msg) => `❌ Switch failed: ${msg}`,
  jumpFailed: (msg) => `❌ Jump failed: ${msg}`,
  mergePreviewError: (msg) => `❌ Merge preview failed: ${msg}`,
  skillInstallError: (msg) => `❌ Skill installation failed: ${msg}`,
  skillRemoveError: (msg) => `❌ Skill removal failed: ${msg}`,
  pathValidationError: (msg) => `❌ Path validation failed: ${msg}`,
  orchestratorErrors: {
    TURN_ALREADY_RUNNING: "⏳ The current thread is still running. Wait until it completes.",
    APPROVAL_PENDING: "⚠️ There are unconfirmed file changes. Approve or revert them before sending a new task.",
    NO_ACTIVE_THREAD: "💡 Mention @bot to create or join a thread first",
    THREAD_NOT_FOUND: "❌ Thread not found. Check the thread name.",
    THREAD_ALREADY_EXISTS: "⚠️ That thread name already exists. Choose another name.",
    PROJECT_NOT_FOUND: "❌ This session is not bound to a valid project. Initialize or rebind the project first.",
    AGENT_API_UNAVAILABLE: "❌ Agent connection is unavailable. Try again later.",
    TURN_BLOCKED_PENDING_APPROVAL: "⚠️ There are unconfirmed file changes. Approve or revert them before sending a new task.",
  }
};

export function getFeishuNotifyStrings(locale: AppLocale): FeishuNotifyStrings {
  return locale === "en-US" ? enUS : zhCN;
}
