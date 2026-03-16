import type { AppLocale } from "../../packages/channel-core/src/app-locale";

export interface PlatformCommandStrings {
  projectAlreadyBound(projectName: string): string;
  projectCreated: string;
  snapshotThreadNameMain: string;
  adminListEmpty: string;
  adminList(count: number, lines: string): string;
  adminTargetRequired: string;
  adminAdded(userSuffix: string): string;
  adminRemoved(userSuffix: string): string;
  adminRemoveRejected(reason: string): string;
  adminUnknownSubcommand: string;
  userProjectMissing: string;
  userList(projectName: string, memberCount: number, memberLines: string, adminSection: string): string;
  userTargetRequired: string;
  userInvalidRole: string;
  userAlreadyExists: string;
  userAdded(userSuffix: string, role: string): string;
  userNotMember(userSuffix: string): string;
  userRoleUpdated(userSuffix: string, role: string): string;
  userRemoved(userSuffix: string): string;
  userUnknownSubcommand: string;
}

const zhCN: PlatformCommandStrings = {
  projectAlreadyBound: (projectName) => `此群已绑定项目 "${projectName}"，无需重复创建`,
  projectCreated: "项目创建成功",
  snapshotThreadNameMain: "main",
  adminListEmpty: "⚠️ 当前没有系统管理员",
  adminList: (count, lines) => `🛡️ 系统管理员 (${count})\n${lines}`,
  adminTargetRequired: "❗ 请指定目标用户，例如 /admin add @someone",
  adminAdded: (userSuffix) => `✅ 已将用户 ${userSuffix} 设为系统管理员`,
  adminRemoved: (userSuffix) => `✅ 已移除管理员 ${userSuffix}`,
  adminRemoveRejected: (reason) => `⚠️ 无法移除：${reason}`,
  adminUnknownSubcommand: "❗ 未知的 /admin 子命令",
  userProjectMissing: "⚠️ 当前群聊未绑定项目，请先初始化项目",
  userList: (projectName, memberCount, memberLines, adminSection) =>
    `👥 **${projectName}** 项目成员 (${memberCount})\n${memberLines}${adminSection}\n\n💡 /user role @someone developer  更改角色\n/user add @someone developer  添加成员\n/user remove @someone  移除成员`,
  userTargetRequired: "❗ 请指定目标用户",
  userInvalidRole: "❗ 无效角色，可选: maintainer, developer, auditor",
  userAlreadyExists: "⚠️ 用户已存在，请 @bot 打开面板更改角色",
  userAdded: (userSuffix, role) => `✅ 已添加用户 ${userSuffix} 为 ${role}`,
  userNotMember: (userSuffix) => `⚠️ 用户 ${userSuffix} 不是项目成员`,
  userRoleUpdated: (userSuffix, role) => `✅ 已将用户 ${userSuffix} 的角色更改为 ${role}`,
  userRemoved: (userSuffix) => `✅ 已移除用户 ${userSuffix}`,
  userUnknownSubcommand: "❗ 未知的 /user 子命令",
};

const enUS: PlatformCommandStrings = {
  projectAlreadyBound: (projectName) => `This chat is already bound to project "${projectName}".`,
  projectCreated: "Project created successfully",
  snapshotThreadNameMain: "main",
  adminListEmpty: "⚠️ No system administrators are configured.",
  adminList: (count, lines) => `🛡️ System administrators (${count})\n${lines}`,
  adminTargetRequired: "❗ Please specify a target user, for example /admin add @someone",
  adminAdded: (userSuffix) => `✅ User ${userSuffix} is now a system administrator`,
  adminRemoved: (userSuffix) => `✅ Removed administrator ${userSuffix}`,
  adminRemoveRejected: (reason) => `⚠️ Remove failed: ${reason}`,
  adminUnknownSubcommand: "❗ Unknown /admin subcommand",
  userProjectMissing: "⚠️ This chat is not bound to a project yet. Initialize a project first.",
  userList: (projectName, memberCount, memberLines, adminSection) =>
    `👥 **${projectName}** project members (${memberCount})\n${memberLines}${adminSection}\n\n💡 /user role @someone developer  Change role\n/user add @someone developer  Add member\n/user remove @someone  Remove member`,
  userTargetRequired: "❗ Please specify a target user",
  userInvalidRole: "❗ Invalid role. Allowed: maintainer, developer, auditor",
  userAlreadyExists: "⚠️ User already exists. Open the panel via @bot to change the role.",
  userAdded: (userSuffix, role) => `✅ Added user ${userSuffix} as ${role}`,
  userNotMember: (userSuffix) => `⚠️ User ${userSuffix} is not a project member`,
  userRoleUpdated: (userSuffix, role) => `✅ Updated user ${userSuffix} to role ${role}`,
  userRemoved: (userSuffix) => `✅ Removed user ${userSuffix}`,
  userUnknownSubcommand: "❗ Unknown /user subcommand",
};

export function getPlatformCommandStrings(locale: AppLocale): PlatformCommandStrings {
  return locale === "en-US" ? enUS : zhCN;
}
