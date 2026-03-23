/**
 * @module services/contracts/src/orchestrator-api
 *
 * L2 Orchestrator 公开 API 接口 — 唯一真实来源（single source of truth）。
 * 所有方法签名严格匹配 docs/01-architecture/core-api.md。
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ L1（src/feishu, src/slack）通过 OrchestratorLayer.api 获取实例。  │
 * │ L1 可以 import 此文件中的类型用于类型标注，但：                     │
 * │   - 所有数据的读写必须通过此接口定义的方法                          │
 * │   - 不可直接 import services/orchestrator/src/** 内部模块          │
 * │ API Guard 拦截层在 L2 内部包装此接口（L1 不感知）。                  │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * @see docs/01-architecture/core-api.md
 */

import type { ProjectRecord } from "../admin/admin-state";
import type { BackendIdentity, BackendId } from "../../../packages/agent-core/src/backend-identity";
import type { ThreadRecord } from "./types/thread";
import type { TurnRecord, TurnStatus, TurnDetailRecord } from "./types/turn";
import type { TurnSnapshotRecord } from "./types/snapshot";
import type { IMFileMergeReview, IMMergeSummary, IMThreadMergeOperation } from "../im/im-output";
import type { PlatformOutput } from "../im/platform-output";
import type { TurnCardData } from "../im/turn-card-data-provider";

// ── Shared input/output types ────────────────────────────────────────────────

/** L1 预解析的输入项（skill 引用、文件附件等）。 */
export type TurnInputItem =
  | { type: "skill"; name: string; path: string }
  | { type: "file"; path: string; content?: string };

/** Merge 操作上下文（可选审计 / trace 信息）。 */
export interface MergeContext {
  traceId?: string;
  threadId?: string;
  turnId?: string;
  userId?: string;
  resolverName?: string;
}

/** Merge API 返回类型 — 6-variant 辨别联合。 */
export type MergeResult =
  | { kind: "preview"; diffStats: MergeDiffStats; baseBranch: string }
  | { kind: "success"; baseBranch: string; message?: string }
  | { kind: "conflict"; conflicts: string[]; baseBranch: string }
  | { kind: "review"; data: IMFileMergeReview }
  | { kind: "summary"; data: IMMergeSummary }
  | { kind: "rejected"; message: string };

/** Merge diff 统计。 */
export interface MergeDiffStats {
  additions: number;
  deletions: number;
  filesChanged: string[];
  fileDiffs?: Array<{ file: string; diff: string }>;
}

// TurnCardData 的规范定义在 contracts/im/turn-card-data-provider.ts，此处 re-export。
export type { TurnCardData };

/** 新增 PlatformOutput 类型：agent/orchestrator 错误通知。 */
export interface IMError {
  code: string;
  message: string;
  source: "agent" | "orchestrator";
  turnId?: string;
}

/** 新增 PlatformOutput 类型：合并异步事件（agent 冲突解析 / resolver 完成 / 超时）。 */
export type IMMergeEvent =
  | { action: "resolver_done"; projectId: string; branchName: string; review: IMFileMergeReview }
  | { action: "resolver_complete"; data: IMThreadMergeOperation }
  | { action: "timeout"; projectId: string; branchName: string };

// ── OrchestratorLayer ────────────────────────────────────────────────────────

/** L0/L1 拿到的唯一入口。 */
export interface OrchestratorLayer {
  api: OrchestratorApi;
  runStartup(gateway: OutputGateway): Promise<void>;
  shutdown(): Promise<void>;
}

export interface OutputGateway {
  dispatch(projectId: string, output: PlatformOutput): Promise<void>;
}

// ── API Guard ────────────────────────────────────────────────────────────────

export interface ApiGuardConfig {
  permission: string | null;
  requiresProject: boolean;
  audit: boolean;
  auditAction?: string;
}

export const Permission = {
  PROJECT_WRITE: "project.write",
  THREAD_READ:   "thread.read",
  THREAD_WRITE:  "thread.write",
  TURN_WRITE:    "turn.write",
  MERGE_WRITE:   "merge.write",
  SKILL_WRITE:   "skill.write",
  ADMIN:         "admin",
} as const;

export class AuthorizationError extends Error {
  constructor(
    public readonly userId: string,
    public readonly permission: string,
    message?: string,
  ) {
    super(message ?? `user ${userId} lacks permission: ${permission}`);
    this.name = "AuthorizationError";
  }
}

// ── OrchestratorApi — 76 methods ─────────────────────────────────────────────

export interface OrchestratorApi {
  // ── §0 项目与绑定 (12 methods) ──

  /** 将平台 chatId 解析为 projectId。L1 入口必调。 */
  resolveProjectId(chatId: string): string | null;

  /** 通过 projectId 获取项目完整元数据。 */
  getProjectRecord(projectId: string): ProjectRecord | null;

  /** 创建新项目并绑定到当前群聊。 */
  createProject(input: {
    chatId: string;
    userId: string;
    name?: string;
    cwd?: string;
    workBranch?: string;
  }): Promise<{
    success: boolean;
    message: string;
    project?: { id: string; name: string; cwd: string };
  }>;

  /** 将已存在的项目绑定到群聊（chat ↔ project 1:1）。 */
  linkProjectToChat(input: {
    chatId: string;
    projectId: string;
    ownerId: string;
  }): Promise<{
    projectId: string;
    projectName: string;
    cwd: string;
    gitUrl?: string;
  }>;

  /** 解除项目与群聊的绑定。 */
  unlinkProject(projectId: string): Promise<void>;

  /** 停用项目（bot 被移出群时）。 */
  disableProject(projectId: string): Promise<void>;

  /** 重新启用已停用的项目。 */
  reactivateProject(projectId: string): Promise<void>;

  /** 永久删除项目（不可逆）。 */
  deleteProject(projectId: string): Promise<void>;

  /** 列出所有项目。 */
  listProjects(): ProjectRecord[];

  /** 列出未绑定的项目。 */
  listUnboundProjects(): Array<{ id: string; name: string; cwd: string; gitUrl?: string }>;

  /** 更新项目 Git 远程地址。 */
  updateGitRemote(input: { projectId: string; gitUrl: string }): Promise<void>;

  /** 更新项目配置。 */
  updateProjectConfig(input: {
    projectId: string;
    workBranch?: string;
    gitUrl?: string;
    gitignoreContent?: string;
    agentsMdContent?: string;
  }): Promise<void>;

  // ── §1 Thread 管理 (8 methods) ──

  /** 创建新线程：注册后端会话、创建 git worktree、绑定用户。 */
  createThread(input: {
    projectId: string;
    userId: string;
    threadName: string;
    backendId?: BackendId;
    model?: string;
    profileName?: string;
    serverCmd?: string;
    cwd?: string;
    approvalPolicy?: string;
  }): Promise<{
    threadId: string;
    threadName: string;
    cwd: string;
  }>;

  /** 切换用户到指定线程。 */
  joinThread(input: {
    projectId: string;
    userId: string;
    threadName: string;
  }): Promise<{
    threadId: string;
    threadName: string;
  }>;

  /** 用户离开当前线程。 */
  leaveThread(input: {
    projectId: string;
    userId: string;
  }): Promise<void>;

  /** 列出项目所有线程（含 creating 状态）。 */
  listThreads(projectId: string): Promise<Array<{
    threadName: string;
    threadId?: string;
    status: "creating" | "active";
    backendId: BackendId;
    model: string;
  }>>;

  /** 删除线程。 */
  deleteThread(input: {
    projectId: string;
    threadName: string;
  }): Promise<void>;

  /** 获取用户当前绑定的活跃线程。 */
  getUserActiveThread(input: {
    projectId: string;
    userId: string;
  }): Promise<{
    threadName: string;
    threadId: string;
    backend: BackendIdentity;
  } | null>;

  /** 获取线程完整元数据。 */
  getThreadRecord(input: {
    projectId: string;
    threadName: string;
  }): Promise<ThreadRecord | null>;

  /** 判断线程是否等待审批。 */
  isPendingApproval(input: {
    projectId: string;
    threadName: string;
  }): boolean;

  // ── §2 Turn 生命周期 (5 methods) ──

  /** 发起新 turn：解析用户线程 → 发送文本到 agent 后端 → 返回 turnId。
   *  NOTE: turn 持久记录 + git snapshot（原 recordTurnStart）是 L2 Path B 内部操作，
   *  由 EventPipeline 在收到首个 agent 事件时自动完成。turnNumber 通过 OutputGateway 推送给 L1。 */
  createTurn(input: {
    projectId: string;
    userId: string;
    text: string;
    traceId?: string;
    mode?: "plan";
    items?: TurnInputItem[];
  }): Promise<{
    turnId: string;
  }>;

  /** 中断当前 turn。 */
  interruptTurn(input: {
    projectId: string;
    userId?: string;
  }): Promise<{
    interrupted: boolean;
  }>;

  /** 接受 turn 代码变更。 */
  acceptTurn(input: {
    projectId: string;
    turnId: string;
  }): Promise<{
    accepted: boolean;
  }>;

  /** 回滚 turn 代码变更。 */
  revertTurn(input: {
    projectId: string;
    turnId: string;
  }): Promise<{
    rolledBack: boolean;
  }>;

  /** 回复 agent 用户输入请求。 */
  respondUserInput(input: {
    projectId: string;
    threadName: string;
    callId: string;
    answers: Record<string, string[]>;
  }): Promise<void>;

  // ── §3 Turn 数据查询 (3 methods) ──
  //
  // NOTE: Turn 数据的写入/更新（updateTurnSummary, updateTurnMetadata,
  // appendTurnEvent, syncTurnState, finalizeTurnState）是 L2 Path B 内部操作。
  // 数据来源于 L3 agent 事件，由 L2 EventPipeline 处理，不暴露给 L1。

  /** 获取 turn 完整聚合数据。 */
  getTurnDetail(input: {
    projectId: string;
    turnId: string;
  }): Promise<{
    record: TurnRecord;
    detail: TurnDetailRecord;
  }>;

  /** 获取 turn 卡片渲染数据（重启恢复用）。 */
  getTurnCardData(input: {
    projectId: string;
    turnId: string;
  }): Promise<TurnCardData | null>;

  /** 列出项目最近 turn 列表。 */
  listTurns(input: {
    projectId: string;
    limit?: number;
  }): Promise<Array<{
    projectId: string;
    turnId: string; threadId: string; threadName: string;
    turnNumber?: number;
    status: TurnStatus;
    promptSummary?: string; lastAgentMessage?: string;
    backendName?: string; modelName?: string;
    filesChangedCount: number;
    tokenUsage?: { input: number; output: number; total?: number };
    createdAt: string; updatedAt: string; completedAt?: string;
  }>>;

  // ── §4 Snapshot 管理 (3 methods) ──
  //
  // NOTE: updateSnapshotSummary 是 L2 Path B 内部操作（finishTurn 自动填充），不暴露给 L1。

  /** 列出线程所有快照。 */
  listSnapshots(input: {
    projectId: string;
    threadId: string;
  }): Promise<Array<{
    projectId?: string; threadId: string; turnId: string;
    turnIndex: number; userId?: string; cwd: string; gitRef: string;
    agentSummary?: string; filesChanged?: string[];
    createdAt: string;
  }>>;

  /** 跳转到指定快照。 */
  jumpToSnapshot(input: {
    projectId: string;
    targetTurnId: string;
    userId?: string;
  }): Promise<{
    snapshot: TurnSnapshotRecord;
    contextReset: boolean;
  }>;

  /** 获取当前线程 vs 上一快照的 diff。 */
  getSnapshotDiff(input: {
    projectId: string;
    userId?: string;
  }): Promise<{
    files: Array<{ path: string; status: string; additions: number; deletions: number }>;
    summary: string;
  } | null>;

  // ── §5 Merge 操作 (17 methods) ──

  /** 执行合并。 */
  handleMerge(input: {
    projectId: string;
    branchName: string;
    force?: boolean;
    deleteBranch?: boolean;
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** 预览合并。 */
  handleMergePreview(input: {
    projectId: string;
    branchName: string;
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** 确认合并。 */
  handleMergeConfirm(input: {
    projectId: string;
    branchName: string;
    deleteBranch?: boolean;
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** 拒绝合并。 */
  handleMergeReject(input: {
    projectId: string;
    branchName: string;
  }): void;

  /** 使用 agent 解决冲突后合并。 */
  handleMergeWithConflictResolver(input: {
    projectId: string;
    branchName: string;
    conflicts: string[];
    userId?: string;
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** 开始逐文件审查。 */
  startMergeReview(input: {
    projectId: string;
    branchName: string;
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** 获取审查状态。 */
  getMergeReview(input: {
    projectId: string;
    branchName: string;
  }): Promise<MergeResult>;

  /** 对单个冲突文件做决定。 */
  mergeDecideFile(input: {
    projectId: string;
    branchName: string;
    filePath: string;
    decision: "accept" | "keep_main" | "use_branch" | "skip";
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** 接受所有剩余冲突文件。 */
  mergeAcceptAll(input: {
    projectId: string;
    branchName: string;
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** 提交审查结果。 */
  commitMergeReview(input: {
    projectId: string;
    branchName: string;
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** 取消审查。 */
  cancelMergeReview(input: {
    projectId: string;
    branchName: string;
    context?: MergeContext;
  }): Promise<void>;

  /** 配置冲突解决器后端。 */
  configureMergeResolver(input: {
    projectId: string;
    branchName: string;
    backendId: string;
    model: string;
  }): Promise<void>;

  /** 启动 agent 解决所有冲突。 */
  resolveConflictsViaAgent(input: {
    projectId: string;
    branchName: string;
    prompt?: string;
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** agent 重新解决单个文件。 */
  retryMergeFile(input: {
    projectId: string;
    branchName: string;
    filePath: string;
    feedback: string;
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** 批量重新解决多个文件。 */
  retryMergeFiles(input: {
    projectId: string;
    branchName: string;
    filePaths: string[];
    feedback: string;
    context?: MergeContext;
  }): Promise<MergeResult>;

  /** 推送 workBranch 到远程。 */
  pushWorkBranch(projectId: string): Promise<void>;

  /** 合并后检测过期线程。 */
  detectStaleThreads(input: {
    projectId: string;
    mergedThreadName: string;
  }): Promise<{
    updated: Array<{ threadName: string; oldSha: string; newSha: string }>;
    stale: Array<{ threadName: string; baseSha: string; workBranchHead: string }>;
    errors: Array<{ threadName: string; error: string }>;
  }>;

  // ── §6 Backend 管理 (15 methods) ──

  /** 列出所有可用后端详情（含 model 可用性过滤）。 */
  listAvailableBackends(): Promise<Array<{
    name: string;
    description?: string;
    transport: "stdio" | "sse";
    serverCmd: string;
    models: string[];
  }>>;

  /** 列出某后端模型列表。 */
  listModelsForBackend(backendId: string): Promise<string[]>;

  /** 解析后端身份。 */
  resolveBackend(input: {
    projectId: string;
    threadName?: string;
  }): Promise<BackendIdentity>;

  /** 解析完整后端会话信息。 */
  resolveSession(input: {
    projectId: string;
    threadName?: string;
  }): Promise<{
    backend: BackendIdentity;
    serverCmd: string;
    availableModels: string[];
    source: "thread-binding" | "default";
  }>;

  /** 读取所有后端配置（data-only view，不含 deploy/buildServerCmd 等方法）。 */
  readBackendConfigs(): Promise<Array<{
    name: string;
    serverCmd: string;
    transport: "codex" | "acp";
    cmdAvailable: boolean;
    activeProvider?: string;
    providers: Array<{
      name: string;
      apiKeySet: boolean;
      models: Array<{ name: string; available: boolean | null; checkedAt?: string; error?: string }>;
    }>;
    policy?: Record<string, string>;
  }>>;

  /** [Admin] 添加后端提供者。 */
  adminAddProvider(input: {
    backendId: string;
    providerName: string;
    baseUrl?: string;
    apiKeyEnv?: string;
  }): Promise<void>;

  /** [Admin] 移除后端提供者。 */
  adminRemoveProvider(input: {
    backendId: string;
    providerName: string;
  }): Promise<void>;

  /** [Admin] 添加模型（异步校验，初始 checking）。 */
  adminAddModel(input: {
    backendId: string;
    providerName: string;
    modelName: string;
    modelConfig?: Record<string, unknown>;
  }): Promise<void>;

  /** [Admin] 移除模型。 */
  adminRemoveModel(input: {
    backendId: string;
    providerName: string;
    modelName: string;
  }): Promise<void>;

  /** [Admin] 触发模型健康检查。 */
  adminTriggerRecheck(input: {
    backendId: string;
    providerName: string;
  }): Promise<void>;

  /** 读取后端策略。 */
  readBackendPolicy(input: {
    backendId: string;
  }): Promise<Record<string, string>>;

  /** 更新后端策略。 */
  updateBackendPolicy(input: {
    backendId: string;
    key: string;
    value: string;
  }): Promise<void>;

  /** [Admin] 写入模型 profile。 */
  adminWriteProfile(input: {
    backendId: string;
    profileName: string;
    model: string;
    provider: string;
    extras?: Record<string, unknown>;
  }): Promise<void>;

  /** [Admin] 删除模型 profile。 */
  adminDeleteProfile(input: { backendId: string; profileName: string }): Promise<void>;

  /** 检查后端可用性。 */
  checkBackendHealth(input: {
    backendId: string;
    providerName?: string;
    modelName?: string;
  }): Promise<{
    backendId: string;
    cmdAvailable: boolean;
    providers: Array<{
      name: string;
      apiKeySet: boolean;
      models: Array<{
        name: string;
        available: boolean | null;
        checkedAt?: string;
        error?: string;
      }>;
    }>;
  }>;

  // ── §7 IAM 与用户管理 (10 methods) ──

  /** 解析用户在项目中的角色（仅用于 UI 展示）。 */
  resolveRole(input: {
    userId: string;
    projectId?: string;
  }): "admin" | "maintainer" | "developer" | "auditor" | null;

  /** 判断用户是否为系统管理员。 */
  isAdmin(userId: string): boolean;

  /** [Admin] 添加系统管理员。 */
  addAdmin(targetUserId: string): void;

  /** [Admin] 移除系统管理员。 */
  removeAdmin(targetUserId: string): { ok: boolean; reason?: string };

  /** 列出所有系统管理员。 */
  listAdmins(): Array<{ userId: string; source: "env" | "im" }>;

  /** 添加项目成员（自动 upsert 用户记录）。 */
  addProjectMember(input: {
    projectId: string;
    userId: string;
    role: "maintainer" | "developer" | "auditor";
  }): void;

  /** 移除项目成员。 */
  removeProjectMember(input: { projectId: string; userId: string }): void;

  /** 更新项目成员角色。 */
  updateProjectMemberRole(input: {
    projectId: string;
    userId: string;
    role: "maintainer" | "developer" | "auditor";
  }): void;

  /** 列出项目成员。 */
  listProjectMembers(projectId: string): Array<{
    userId: string;
    role: "maintainer" | "developer" | "auditor";
  }>;

  /** [Admin] 分页列出系统所有用户。 */
  listUsers(input?: {
    offset?: number;
    limit?: number;
    userIds?: string[];
  }): { users: Array<{ userId: string; sysRole: string; source: string }>; total: number };

  // ── §8 Skill 管理 (10 methods) ──

  /** 列出可用技能目录（含安装/启用状态）。 */
  listSkills(projectId?: string): Promise<Array<{
    name: string;
    description?: string;
    installed: boolean;
    enabled?: boolean;
  }>>;

  /** 列出项目已启用技能。 */
  listProjectSkills(projectId: string): Promise<Array<{
    name: string; description?: string; enabled: boolean;
  }>>;

  /** 安装并启用技能到项目。 */
  installSkill(input: {
    source: string; projectId?: string; userId?: string;
  }): Promise<{ name: string; description?: string }>;

  /** 移除技能。 */
  removeSkill(input: { name: string; projectId?: string }): Promise<boolean>;

  /** 绑定技能到项目。 */
  bindSkillToProject(projectId: string, skillName: string): Promise<void>;

  /** 解绑技能。 */
  unbindSkillFromProject(projectId: string, skillName: string): Promise<boolean>;

  /** 从 GitHub 安装技能。 */
  installFromGithub(input: {
    repoUrl: string;
    skillSubpath: string;
    pluginName?: string;
    actorId: string;
    description?: string;
    autoEnableProjectId?: string;
  }): Promise<{ name: string; description?: string }>;

  /** 从本地路径安装技能。 */
  installFromLocalSource(input: {
    localPath: string; pluginName: string; projectId?: string;
  }): Promise<{ name: string; description?: string }>;

  /** 检查本地技能源文件。 */
  inspectLocalSource(input: {
    localPath: string; sourceType: string;
    preferredPluginName?: string; extractionDir?: string;
  }): Promise<{
    resolvedPluginName: string; resolvedLocalPath: string;
    manifestName?: string; manifestDescription?: string;
  }>;

  /** 分配技能暂存目录。 */
  allocateStagingDir(scope: string, userId: string): Promise<string>;

  // ── §9 审批回调 (1 method) ──

  /** 处理审批回调。 */
  handleApprovalCallback(input: {
    approvalId: string;
    decision: "accept" | "decline" | "approve_always";
  }): Promise<"resolved" | "duplicate">;
}
