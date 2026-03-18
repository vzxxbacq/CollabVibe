import type { AppLocale } from "../../services/contracts/im/app-locale";

export interface FeishuMessageHandlerStrings {
  skillStagingUnavailable: string;
  unsupportedSkillArchive(fileName: string): string;
  skillManifestUnavailable: string;
  skillFileInstallTimeoutUploaded: string;
  skillFileInstallReceived(fileName: string): string;
  skillFileInstallFailed(message: string): string;
  skillNameRequired: string;
  pluginNameRequired: string;
  pluginNotFound(name: string): string;
  removeFailed(message: string): string;
  projectDisabled: string;
  unknownArchive: string;
  archiveTarGz: string;
  archiveTgz: string;
  archiveZip: string;
  planPromptFallback: string;
  mergePreviewPending: string;
  mergeResolving(count: number, conflictList: string): string;
  mergeConflictDetected: string;
  mergeFailed: string;
  mergeDone: string;
  threadJoinHint: string;
  feishuFileSourceLabel: string;
  skillInstallExpiresHint: string;
}

const zhCN: FeishuMessageHandlerStrings = {
  skillStagingUnavailable: "当前服务未启用 Skill staging 目录分配",
  unsupportedSkillArchive: (fileName) => `当前仅支持上传 zip / tgz Skill 压缩包；收到的文件为：${fileName}。建议先打包单个 Skill 目录后再上传。`,
  skillManifestUnavailable: "当前服务未启用 Skill manifest 解析",
  skillFileInstallTimeoutUploaded: "Skill 文件安装已超时取消：文件已上传，但 10 分钟内未确认安装。",
  skillFileInstallReceived: (fileName) => `已收到 Skill 文件：${fileName}，请在管理面板确认安装。`,
  skillFileInstallFailed: (message) => `Skill 文件安装失败：${message}`,
  skillNameRequired: "⚠️ 请提供 Skill 名称：`/skill install <skillName>`",
  pluginNameRequired: "⚠️ 请提供 plugin 名称：`/skill remove <name>`",
  pluginNotFound: (name) => `⚠️ Plugin "${name}" 不存在`,
  removeFailed: (message) => `⚠️ 移除失败: ${message}`,
  projectDisabled: "⚠️ 项目已禁用，请联系管理员启用",
  unknownArchive: "未知",
  archiveTarGz: "tar.gz",
  archiveTgz: "tgz",
  archiveZip: "zip",
  planPromptFallback: "请先给出执行计划。",
  mergePreviewPending: "合并预览 — 等待审批",
  mergeResolving: (count, conflictList) => `🔄 检测到 **${count}** 个冲突文件，Agent 正在自动解决…\n${conflictList}\n\n解决完成后将自动开始逐文件审阅。`,
  mergeConflictDetected: "检测到合并冲突",
  mergeFailed: "合并失败",
  mergeDone: "已合并",
  threadJoinHint: "请先 /thread new 或 /thread join",
  feishuFileSourceLabel: "Feishu 文件",
  skillInstallExpiresHint: "10 分钟内确认，否则自动取消",
};

const enUS: FeishuMessageHandlerStrings = {
  skillStagingUnavailable: "Skill staging directory allocation is not enabled for this service",
  unsupportedSkillArchive: (fileName) => `Only zip / tgz skill archives are supported. Received: ${fileName}. Package a single skill directory first and upload it again.`,
  skillManifestUnavailable: "Skill manifest inspection is not enabled for this service",
  skillFileInstallTimeoutUploaded: "Skill file installation timed out: the file was uploaded but not confirmed within 10 minutes.",
  skillFileInstallReceived: (fileName) => `Received skill file: ${fileName}. Please confirm installation from the admin panel.`,
  skillFileInstallFailed: (message) => `Skill file installation failed: ${message}`,
  skillNameRequired: "⚠️ Please provide a skill name: `/skill install <skillName>`",
  pluginNameRequired: "⚠️ Please provide a plugin name: `/skill remove <name>`",
  pluginNotFound: (name) => `⚠️ Plugin "${name}" does not exist`,
  removeFailed: (message) => `⚠️ Remove failed: ${message}`,
  projectDisabled: "⚠️ This project is disabled. Contact an administrator to enable it.",
  unknownArchive: "unknown",
  archiveTarGz: "tar.gz",
  archiveTgz: "tgz",
  archiveZip: "zip",
  planPromptFallback: "Please provide an execution plan first.",
  mergePreviewPending: "Merge preview — awaiting approval",
  mergeResolving: (count, conflictList) => `🔄 Detected **${count}** conflicting files. Agent is resolving them automatically…\n${conflictList}\n\nFile-by-file review will start automatically after resolution completes.`,
  mergeConflictDetected: "Merge conflict detected",
  mergeFailed: "Merge failed",
  mergeDone: "Merged",
  threadJoinHint: "Please /thread new or /thread join first",
  feishuFileSourceLabel: "Feishu file",
  skillInstallExpiresHint: "Confirm within 10 minutes, or it will be canceled automatically",
};

export function getFeishuMessageHandlerStrings(locale: AppLocale): FeishuMessageHandlerStrings {
  return locale === "en-US" ? enUS : zhCN;
}
