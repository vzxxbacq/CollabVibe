# L2 Orchestrator Core API

> [!CAUTION]
> **本文档定义 L2 公开 API 的完整契约。**
> 对该表的任何修改（增删改 API、变更签名/语义）**必须经过讨论和审批**。
> L0/L1 **只能** 通过此 API 表访问 L2，**禁止**任何不经允许的修改或绕过。


## API 入口

```typescript
interface OrchestratorLayer {
  api: OrchestratorApi;
  runStartup(gateway: OutputGateway): Promise<void>;
  shutdown(): Promise<void>;
}
```

---

## 🔒 API Guard 拦截层

> [!CAUTION]
> 此拦截层是 L2 API 的**第一道防线**，每个 API 调用都必须经过此层。
> 鉴权 + 审计作为 L2 内部横切关注点，不暴露给 L1。

每个 L2 API 方法通过统一拦截器自动执行鉴权和审计（等价于 Python `@require_auth @audit_log`）。
L1 不感知此层的存在，只需 catch `AuthorizationError`。

```typescript
interface ApiGuardConfig {
  permission: string | null;   // null = 公开
  requiresProject: boolean;
  audit: boolean;
  auditAction?: string;
}

const Permission = {
  PROJECT_WRITE:  "project.write",
  THREAD_READ:    "thread.read",
  THREAD_WRITE:   "thread.write",
  TURN_WRITE:     "turn.write",
  MERGE_WRITE:    "merge.write",
  SKILL_WRITE:    "skill.write",
  ADMIN:          "admin",
} as const;

const API_GUARDS: Record<string, ApiGuardConfig> = {
  // §0 项目与绑定
  resolveProjectId:    { permission: null,                    requiresProject: false, audit: false },
  getProjectRecord:    { permission: null,                    requiresProject: false, audit: false },
  createProject:       { permission: Permission.PROJECT_WRITE, requiresProject: false, audit: true, auditAction: "project.create" },
  linkProjectToChat:   { permission: Permission.PROJECT_WRITE, requiresProject: false, audit: true, auditAction: "project.link" },
  unlinkProject:       { permission: Permission.PROJECT_WRITE, requiresProject: true,  audit: true, auditAction: "project.unlink" },
  disableProject:      { permission: Permission.PROJECT_WRITE, requiresProject: true,  audit: true, auditAction: "project.disable" },
  reactivateProject:   { permission: Permission.PROJECT_WRITE, requiresProject: true,  audit: true, auditAction: "project.reactivate" },
  deleteProject:       { permission: Permission.ADMIN,         requiresProject: true,  audit: true, auditAction: "project.delete" },
  listProjects:        { permission: null,                    requiresProject: false, audit: false },
  listUnboundProjects: { permission: Permission.ADMIN,         requiresProject: false, audit: false },
  updateGitRemote:     { permission: Permission.PROJECT_WRITE, requiresProject: true,  audit: true, auditAction: "project.updateGitRemote" },
  updateProjectConfig: { permission: Permission.PROJECT_WRITE, requiresProject: true,  audit: true, auditAction: "project.updateConfig" },

  // §1 Thread
  createThread:        { permission: Permission.THREAD_WRITE,  requiresProject: true,  audit: true, auditAction: "thread.create" },
  joinThread:          { permission: Permission.THREAD_WRITE,  requiresProject: true,  audit: true, auditAction: "thread.join" },
  leaveThread:         { permission: Permission.THREAD_WRITE,  requiresProject: true,  audit: true, auditAction: "thread.leave" },
  deleteThread:        { permission: Permission.THREAD_WRITE,  requiresProject: true,  audit: true, auditAction: "thread.delete" },
  listThreads:         { permission: Permission.THREAD_READ,   requiresProject: true,  audit: false },
  getUserActiveThread: { permission: null,                    requiresProject: true,  audit: false },
  getThreadRecord:     { permission: null,                    requiresProject: true,  audit: false },
  isPendingApproval:   { permission: null,                    requiresProject: true,  audit: false },

  // §2 Turn
  createTurn:          { permission: Permission.TURN_WRITE,    requiresProject: true,  audit: true, auditAction: "turn.create" },
  interruptTurn:       { permission: Permission.TURN_WRITE,    requiresProject: true,  audit: true, auditAction: "turn.interrupt" },
  acceptTurn:          { permission: Permission.TURN_WRITE,    requiresProject: true,  audit: true, auditAction: "turn.accept" },
  revertTurn:          { permission: Permission.TURN_WRITE,    requiresProject: true,  audit: true, auditAction: "turn.revert" },
  respondUserInput:    { permission: Permission.TURN_WRITE,    requiresProject: true,  audit: false },

  // §3 Turn 数据
  getTurnDetail:       { permission: null,                    requiresProject: true,  audit: false },
  getTurnCardData:     { permission: null,                    requiresProject: true,  audit: false },
  listTurns:           { permission: null,                    requiresProject: true,  audit: false },

  // §4 Snapshot
  listSnapshots:       { permission: null,                    requiresProject: true,  audit: false },
  jumpToSnapshot:      { permission: Permission.TURN_WRITE,    requiresProject: true,  audit: true, auditAction: "snapshot.jump" },
  getSnapshotDiff:     { permission: null,                    requiresProject: true,  audit: false },

  // §5 Merge
  handleMerge:         { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: true, auditAction: "merge.execute" },
  handleMergePreview:  { permission: null,                    requiresProject: true,  audit: false },
  handleMergeConfirm:  { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: true, auditAction: "merge.confirm" },
  handleMergeReject:   { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: false },
  handleMergeWithConflictResolver: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: true, auditAction: "merge.resolve" },
  startMergeReview:    { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: true, auditAction: "merge.review.start" },
  getMergeReview:      { permission: null,                    requiresProject: true,  audit: false },
  mergeDecideFile:     { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: false },
  mergeAcceptAll:      { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: false },
  commitMergeReview:   { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: true, auditAction: "merge.commit" },
  cancelMergeReview:   { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: true, auditAction: "merge.cancel" },
  configureMergeResolver: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: false },
  resolveConflictsViaAgent: { permission: Permission.MERGE_WRITE, requiresProject: true, audit: true, auditAction: "merge.agentResolve" },
  retryMergeFile:      { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: false },
  retryMergeFiles:     { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: false },
  pushWorkBranch:      { permission: Permission.MERGE_WRITE,   requiresProject: true,  audit: true, auditAction: "branch.push" },
  detectStaleThreads:  { permission: null,                    requiresProject: true,  audit: false },

  // §6 Backend 管理
  listAvailableBackends: { permission: null,                  requiresProject: false, audit: false },
  listModelsForBackend: { permission: null,                   requiresProject: false, audit: false },
  resolveBackend:      { permission: null,                    requiresProject: true,  audit: false },
  resolveSession:      { permission: null,                    requiresProject: true,  audit: false },
  readBackendConfigs:  { permission: null,                    requiresProject: false, audit: false },
  readBackendPolicy:   { permission: null,                    requiresProject: false, audit: false },
  updateBackendPolicy: { permission: Permission.ADMIN,         requiresProject: false, audit: true, auditAction: "backend.updatePolicy" },
  adminAddProvider:    { permission: Permission.ADMIN,         requiresProject: false, audit: true, auditAction: "backend.addProvider" },
  adminRemoveProvider: { permission: Permission.ADMIN,         requiresProject: false, audit: true, auditAction: "backend.removeProvider" },
  adminAddModel:       { permission: Permission.ADMIN,         requiresProject: false, audit: true, auditAction: "backend.addModel" },
  adminRemoveModel:    { permission: Permission.ADMIN,         requiresProject: false, audit: true, auditAction: "backend.removeModel" },
  adminTriggerRecheck: { permission: Permission.ADMIN,         requiresProject: false, audit: true, auditAction: "backend.recheck" },
  adminWriteProfile:   { permission: Permission.ADMIN,         requiresProject: false, audit: true, auditAction: "backend.writeProfile" },
  adminDeleteProfile:  { permission: Permission.ADMIN,         requiresProject: false, audit: true, auditAction: "backend.deleteProfile" },
  checkBackendHealth:  { permission: null,                    requiresProject: false, audit: false },

  // §7 IAM
  resolveRole:         { permission: null,                    requiresProject: false, audit: false },
  isAdmin:             { permission: null,                    requiresProject: false, audit: false },
  addAdmin:            { permission: Permission.ADMIN,         requiresProject: false, audit: true, auditAction: "admin.add" },
  removeAdmin:         { permission: Permission.ADMIN,         requiresProject: false, audit: true, auditAction: "admin.remove" },
  listAdmins:          { permission: null,                    requiresProject: false, audit: false },
  addProjectMember:    { permission: Permission.PROJECT_WRITE, requiresProject: true,  audit: true, auditAction: "member.add" },
  removeProjectMember: { permission: Permission.PROJECT_WRITE, requiresProject: true,  audit: true, auditAction: "member.remove" },
  updateProjectMemberRole: { permission: Permission.PROJECT_WRITE, requiresProject: true, audit: true, auditAction: "member.updateRole" },
  listProjectMembers:  { permission: null,                    requiresProject: true,  audit: false },
  listUsers:           { permission: Permission.ADMIN,         requiresProject: false, audit: false },

  // §8 Skill
  listSkills:          { permission: null,                    requiresProject: false, audit: false },
  listProjectSkills:   { permission: null,                    requiresProject: true,  audit: false },
  installSkill:        { permission: Permission.SKILL_WRITE,   requiresProject: true,  audit: true, auditAction: "skill.install" },
  removeSkill:         { permission: Permission.SKILL_WRITE,   requiresProject: true,  audit: true, auditAction: "skill.remove" },
  bindSkillToProject:  { permission: Permission.SKILL_WRITE,   requiresProject: true,  audit: true, auditAction: "skill.bind" },
  unbindSkillFromProject: { permission: Permission.SKILL_WRITE, requiresProject: true, audit: true, auditAction: "skill.unbind" },
  installFromGithub:   { permission: Permission.SKILL_WRITE,   requiresProject: false, audit: true, auditAction: "skill.installGithub" },
  installFromLocalSource: { permission: Permission.SKILL_WRITE, requiresProject: false, audit: true, auditAction: "skill.installLocal" },
  inspectLocalSource:  { permission: null,                    requiresProject: false, audit: false },
  allocateStagingDir:  { permission: null,                    requiresProject: false, audit: false },

  // §9 审批
  handleApprovalCallback: { permission: null,                 requiresProject: false, audit: true, auditAction: "approval.callback" },
};

function withApiGuards(
  rawApi: OrchestratorApi,
  authService: AuthService,
  auditLog: AuditLogWriter
): OrchestratorApi {
  return new Proxy(rawApi, {
    get(target, prop: string) {
      const original = target[prop];
      if (typeof original !== "function") return original;
      const guard = API_GUARDS[prop];
      if (!guard) return original;

      return async (...args: unknown[]) => {
        const input = args[0] as { userId?: string; projectId?: string };
        if (guard.permission) {
          authService.authorize(input.userId, input.projectId, guard.permission);
        }
        let result: unknown;
        let auditResult: "ok" | "denied" | "error" = "ok";
        try {
          result = await original.apply(target, args);
        } catch (err) {
          auditResult = err instanceof AuthorizationError ? "denied" : "error";
          throw err;
        } finally {
          if (guard.audit && guard.auditAction) {
            auditLog.append({
              projectId: input.projectId ?? "",
              actorId: input.userId ?? "",
              action: guard.auditAction,
              result: auditResult,
            });
          }
        }
        return result;
      };
    }
  });
}
```

---

## §0 项目与绑定

```typescript
/** 将平台 chatId 解析为 projectId。L1 入口必调。 */
resolveProjectId(chatId: string): string | null

/** 通过 projectId 获取项目完整元数据。 */
getProjectRecord(projectId: string): ProjectRecord | null
// ProjectRecord = {
//   id: string; name: string; chatId: string; cwd: string;
//   defaultBranch: string; workBranch: string; gitUrl?: string;
//   sandbox: string; approvalPolicy: string;
//   status: "active" | "disabled";
//   enabledSkills: string[];
//   createdAt: string; updatedAt: string;
// }

/** 创建新项目并绑定到当前群聊。 */
createProject(input: {
  chatId: string;
  userId: string;
  actorId: string;
  name?: string;
  cwd?: string;
  gitUrl?: string;
  gitToken?: string;
  workBranch?: string;
  initialFiles?: {
    agentsMd?: {
      encoding: "base64";
      contentBase64: string;
    };
    gitignore?: {
      encoding: "base64";
      contentBase64: string;
    };
  };
}): Promise<{
  success: boolean;
  message: string;
  project?: { id: string; name: string; cwd: string };
}>

// initialFiles 仅用于项目初始化 bootstrap：
// - L2 在 createProject 成功路径中写入 project.cwd
// - contentBase64 解码为 UTF-8 文本后落盘
// - 不负责 worktree 同步
// - 任一文件解码/写入失败时，createProject 整体失败

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
}>

/** 解除项目与群聊的绑定。 */
unlinkProject(projectId: string): Promise<void>

/** 停用项目（bot 被移出群时）。 */
disableProject(projectId: string): Promise<void>

/** 重新启用已停用的项目。 */
reactivateProject(projectId: string): Promise<void>

/** 永久删除项目（不可逆）。 */
deleteProject(projectId: string): Promise<void>

/** 列出所有项目。 */
listProjects(): ProjectRecord[]

/** 列出未绑定的项目。 */
listUnboundProjects(): Array<{ id: string; name: string; cwd: string; gitUrl?: string }>

/** 更新项目 Git 远程地址。 */
updateGitRemote(input: { projectId: string; gitUrl: string }): Promise<void>

/** 更新项目配置。 */
updateProjectConfig(input: {
  projectId: string;
  workBranch?: string;
  gitUrl?: string;
  gitignoreContent?: string;
  agentsMdContent?: string;
}): Promise<void>
```

> [!NOTE]
> `onProjectDeactivated` — L1 层职责，bot 被移出群聊时 L1 调用 `disableProject(projectId)`。
> `recoverSessions` — `runStartup` 内部自动调用，不作为 public API 暴露。

---

## §1 Thread 管理

```typescript
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
}>

/** 切换用户到指定线程。 */
joinThread(input: {
  projectId: string;
  userId: string;
  threadName: string;
}): Promise<{
  threadId: string;
  threadName: string;
}>

/** 用户离开当前线程。 */
leaveThread(input: {
  projectId: string;
  userId: string;
}): Promise<void>

/** 列出项目所有线程（含 creating 状态）。 */
listThreads(projectId: string): Promise<Array<{
  threadName: string;
  threadId?: string;
  status: "creating" | "active";
  backendId: BackendId;
  model: string;
}>>

/** 删除线程。 */
deleteThread(input: {
  projectId: string;
  threadName: string;
}): Promise<void>

/** 获取用户当前绑定的活跃线程。 */
getUserActiveThread(input: {
  projectId: string;
  userId: string;
}): Promise<{
  threadName: string;
  threadId: string;
  backend: BackendIdentity;
} | null>

/** 获取线程完整元数据。 */
getThreadRecord(input: {
  projectId: string;
  threadName: string;
}): Promise<ThreadRecord | null>

/** 判断线程是否等待审批。 */
isPendingApproval(input: {
  projectId: string;
  threadName: string;
}): boolean
```

---

## §2 Turn 生命周期

```typescript
/** L1 预解析的输入项（skill 引用、文件附件等）。 */
type TurnInputItem =
  | { type: "skill"; name: string; path: string }
  | { type: "file"; path: string; content?: string };

/** 发起新 turn：解析用户线程 → 发送文本到 agent 后端 → 返回 turnId。
 *  items 由 L1 预解析（如 $skill-name 引用），不传则仅发送纯文本。 */
createTurn(input: {
  projectId: string;
  userId: string;
  text: string;
  traceId?: string;
  mode?: "plan";
  items?: TurnInputItem[];  // L1 预解析的 skill/file 引用
}): Promise<{
  turnId: string;
}>

// NOTE: recordTurnStart 是 L2 Path B 内部操作。
// L2 EventPipeline 收到首个 agent 事件时自动创建 turn 持久记录 + git snapshot。
// turnNumber 通过 OutputGateway 推送给 L1，不由 createTurn 返回。

/** 中断当前 turn。 */
interruptTurn(input: {
  projectId: string;
  userId?: string;
}): Promise<{
  interrupted: boolean;
}>

/** 接受 turn 代码变更。 */
acceptTurn(input: {
  projectId: string;
  turnId: string;
}): Promise<{
  accepted: boolean;
}>

/** 回滚 turn 代码变更。 */
revertTurn(input: {
  projectId: string;
  turnId: string;
}): Promise<{
  rolledBack: boolean;
}>

/** 回复 agent 用户输入请求。 */
respondUserInput(input: {
  projectId: string;
  threadName: string;
  callId: string;
  answers: Record<string, string[]>;
}): Promise<void>
```

---

## §3 Turn 数据查询与更新

```typescript
/** 获取 turn 完整聚合数据。 */
getTurnDetail(input: {
  projectId: string;
  turnId: string;
}): Promise<{
  record: TurnRecord;
  detail: TurnDetailRecord;
}>

/** 获取 turn 卡片渲染数据（重启恢复用）。 */
getTurnCardData(input: {
  projectId: string;
  turnId: string;
}): Promise<TurnCardData | null>

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
}>>

// NOTE: Turn 数据的写入/更新（updateTurnSummary, updateTurnMetadata,
// appendTurnEvent, syncTurnState, finalizeTurnState）是 L2 Path B 内部操作，
// 由 EventPipeline 处理 agent 事件时自动执行，不暴露为 L1 公开 API。
// 详见 orchestrator-internals.md §Event Pipeline。
```

---

## §4 Snapshot 管理

```typescript
/** 列出线程所有快照。 */
listSnapshots(input: {
  projectId: string;
  threadId: string;
}): Promise<Array<{
  projectId?: string; threadId: string; turnId: string;
  turnIndex: number; userId?: string; cwd: string; gitRef: string;
  agentSummary?: string; filesChanged?: string[];
  createdAt: string;
}>>

/** 跳转到指定快照。 */
jumpToSnapshot(input: {
  projectId: string;
  targetTurnId: string;
  userId?: string;
}): Promise<{
  snapshot: TurnSnapshotRecord;
  contextReset: boolean;
}>

// NOTE: updateSnapshotSummary 是 L2 Path B 内部操作（finishTurn 自动填充），
// 不暴露给 L1。

/** 获取当前线程 vs 上一快照的 diff。 */
getSnapshotDiff(input: {
  projectId: string;
  userId?: string;
}): Promise<{
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
  summary: string;
} | null>
```

---

## §5 Merge 操作

```typescript
// MergeContext = { traceId?: string; threadId?: string;
//   turnId?: string; userId?: string; resolverName?: string; }

/** Merge API 返回类型（在 services/contracts 中定义）。 */
type MergeResult =
  | { kind: "preview"; diffStats: MergeDiffStats; baseBranch: string }
  | { kind: "success"; baseBranch: string; message?: string }
  | { kind: "conflict"; conflicts: string[]; baseBranch: string }
  | { kind: "review"; data: IMFileMergeReview }
  | { kind: "summary"; data: IMMergeSummary }
  | { kind: "rejected"; message: string };

/** 执行合并。 */
handleMerge(input: {
  projectId: string;
  branchName: string;
  force?: boolean;
  deleteBranch?: boolean;
  context?: MergeContext;
}): Promise<MergeResult>  // success | conflict

/** 预览合并。 */
handleMergePreview(input: {
  projectId: string;
  branchName: string;
  context?: MergeContext;
}): Promise<MergeResult>  // preview

/** 确认合并。 */
handleMergeConfirm(input: {
  projectId: string;
  branchName: string;
  deleteBranch?: boolean;
  context?: MergeContext;
}): Promise<MergeResult>  // success | conflict

/** 拒绝合并。 */
handleMergeReject(input: {
  projectId: string;
  branchName: string;
}): void

/** 使用 agent 解决冲突后合并。 */
handleMergeWithConflictResolver(input: {
  projectId: string;
  branchName: string;
  conflicts: string[];
  userId?: string;
  context?: MergeContext;
}): Promise<MergeResult>  // conflict (agent 异步处理，结果通过 OutputGateway 推送)

/** 开始逐文件审查。 */
startMergeReview(input: {
  projectId: string;
  branchName: string;
  context?: MergeContext;
}): Promise<MergeResult>  // review

/** 获取审查状态。 */
getMergeReview(input: {
  projectId: string;
  branchName: string;
}): Promise<MergeResult>  // review

/** 对单个冲突文件做决定。 */
mergeDecideFile(input: {
  projectId: string;
  branchName: string;
  filePath: string;
  decision: "accept" | "keep_main" | "use_branch" | "skip";
  context?: MergeContext;
}): Promise<MergeResult>  // review | summary

/** 接受所有剩余冲突文件。 */
mergeAcceptAll(input: {
  projectId: string;
  branchName: string;
  context?: MergeContext;
}): Promise<MergeResult>  // summary

/** 提交审查结果。 */
commitMergeReview(input: {
  projectId: string;
  branchName: string;
  context?: MergeContext;
}): Promise<MergeResult>  // success | rejected

/** 取消审查。 */
cancelMergeReview(input: {
  projectId: string;
  branchName: string;
  context?: MergeContext;
}): Promise<void>

/** 配置冲突解决器后端。 */
configureMergeResolver(input: {
  projectId: string;
  branchName: string;
  backendId: string;
  model: string;
}): Promise<void>

/** 启动 agent 解决所有冲突。 */
resolveConflictsViaAgent(input: {
  projectId: string;
  branchName: string;
  prompt?: string;
  context?: MergeContext;
}): Promise<MergeResult>  // review (当前状态，agent 异步处理，完成后通过 OutputGateway 推送 merge_event action=resolver_done)

/** agent 重新解决单个文件。 */
retryMergeFile(input: {
  projectId: string;
  branchName: string;
  filePath: string;
  feedback: string;
  context?: MergeContext;
}): Promise<MergeResult>  // review

/** 批量重新解决多个文件。 */
retryMergeFiles(input: {
  projectId: string;
  branchName: string;
  filePaths: string[];
  feedback: string;
  context?: MergeContext;
}): Promise<MergeResult>  // review

/** 推送 workBranch 到远程。 */
pushWorkBranch(projectId: string): Promise<void>

/** 合并后检测过期线程。 */
detectStaleThreads(input: {
  projectId: string;
  mergedThreadName: string;
}): Promise<{
  updated: Array<{ threadName: string; oldSha: string; newSha: string }>;
  stale: Array<{ threadName: string; baseSha: string; workBranchHead: string }>;
  errors: Array<{ threadName: string; error: string }>;
}>
```

---

## §6 Backend 管理

```typescript
/** 列出所有可用后端详情（含 model 可用性过滤）。 */
listAvailableBackends(): Promise<Array<{
  name: string;
  description?: string;
  transport: "stdio" | "sse";
  serverCmd: string;
  models: string[];
}>>

/** 列出某后端模型列表。 */
listModelsForBackend(backendId: string): Promise<string[]>

/** 解析后端身份。 */
resolveBackend(input: {
  projectId: string;
  threadName?: string;
}): Promise<BackendIdentity>

/** 解析完整后端会话信息。 */
resolveSession(input: {
  projectId: string;
  threadName?: string;
}): Promise<{
  backend: BackendIdentity;
  serverCmd: string;
  availableModels: string[];
  source: "thread-binding" | "default";
}>

/** 读取所有后端配置。 */
readBackendConfigs(): Promise<BackendConfigInfo[]>

/** [Admin] 添加后端提供者。 */
adminAddProvider(input: {
  backendId: string;
  providerName: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}): Promise<void>

/** [Admin] 移除后端提供者。 */
adminRemoveProvider(input: {
  backendId: string;
  providerName: string;
}): Promise<void>

/** [Admin] 添加模型（异步校验，初始 checking）。 */
adminAddModel(input: {
  backendId: string;
  providerName: string;
  modelName: string;
  modelConfig?: Record<string, unknown>;
}): Promise<void>

/** [Admin] 移除模型。 */
adminRemoveModel(input: {
  backendId: string;
  providerName: string;
  modelName: string;
}): Promise<void>

/** [Admin] 触发模型健康检查。 */
adminTriggerRecheck(input: {
  backendId: string;
  providerName: string;
}): Promise<void>

/** 读取后端策略（速率限制、路由规则等）。 */
readBackendPolicy(input: {
  backendId: string;
}): Promise<Record<string, string>>

/** 更新后端策略。 */
updateBackendPolicy(input: {
  backendId: string;
  key: string;
  value: string;
}): Promise<void>

/** [Admin] 写入模型 profile。 */
adminWriteProfile(input: {
  backendId: string;
  profileName: string;
  model: string;
  provider: string;
  extras?: Record<string, unknown>;
}): Promise<void>

/** [Admin] 删除模型 profile。 */
adminDeleteProfile(input: { backendId: string; profileName: string }): Promise<void>

/** 检查后端可用性（CLI 是否存在、API Key 是否配置、模型是否可用）。
 *  用于 L1 在创建线程前预检、或在 admin 面板展示后端健康状态。 */
checkBackendHealth(input: {
  backendId: string;
  providerName?: string;   // 不传则检查所有 provider
  modelName?: string;      // 不传则检查所有 model
}): Promise<{
  backendId: string;
  cmdAvailable: boolean;
  providers: Array<{
    name: string;
    apiKeySet: boolean;
    models: Array<{
      name: string;
      available: boolean | null;   // null = 未检查
      checkedAt?: string;
      error?: string;
    }>;
  }>;
}>
```

---

## §7 IAM 与用户管理

> [!IMPORTANT]
> 鉴权 + 审计由 Guard 拦截层自动执行（见上文），不单独暴露。
> L1 统一 catch `AuthorizationError` 渲染错误卡片。

```typescript
/** 解析用户在项目中的角色（仅用于 UI 展示）。 */
resolveRole(input: {
  userId: string;
  projectId?: string;
}): "admin" | "maintainer" | "developer" | "auditor" | null

/** 判断用户是否为系统管理员。 */
isAdmin(userId: string): boolean

/** [Admin] 添加系统管理员。 */
addAdmin(targetUserId: string): void

/** [Admin] 移除系统管理员。 */
removeAdmin(targetUserId: string): { ok: boolean; reason?: string }

/** 列出所有系统管理员。 */
listAdmins(): Array<{ userId: string; source: "env" | "im" }>

/** 添加项目成员（自动 upsert 用户记录）。 */
addProjectMember(input: {
  projectId: string;
  userId: string;
  role: "maintainer" | "developer" | "auditor";
}): void

/** 移除项目成员。 */
removeProjectMember(input: { projectId: string; userId: string }): void

/** 更新项目成员角色。 */
updateProjectMemberRole(input: {
  projectId: string;
  userId: string;
  role: "maintainer" | "developer" | "auditor";
}): void

/** 列出项目成员。 */
listProjectMembers(projectId: string): Array<{
  userId: string;
  role: "maintainer" | "developer" | "auditor";
}>

/** [Admin] 分页列出系统所有用户。 */
listUsers(input?: {
  offset?: number;
  limit?: number;
  userIds?: string[];
}): { users: Array<{ userId: string; sysRole: string; source: string }>; total: number }
```

---

## §8 Skill 管理

```typescript
/** 列出可用技能目录（含安装/启用状态）。 */
listSkills(projectId?: string): Promise<Array<{
  name: string;
  description?: string;
  installed: boolean;
  enabled?: boolean;
}>>

/** 列出项目已启用技能。 */
listProjectSkills(projectId: string): Promise<Array<{
  name: string; description?: string; enabled: boolean;
}>>

/** 安装并启用技能到项目。 */
installSkill(input: {
  source: string; projectId?: string; userId?: string;
}): Promise<{ name: string; description?: string }>

/** 移除技能。 */
removeSkill(input: { name: string; projectId?: string }): Promise<boolean>

/** 绑定技能到项目。 */
bindSkillToProject(projectId: string, skillName: string): Promise<void>

/** 解绑技能。 */
unbindSkillFromProject(projectId: string, skillName: string): Promise<boolean>

/** 从 GitHub 安装技能（内部自动验证名称）。 */
installFromGithub(input: {
  repoUrl: string;
  skillSubpath: string;
  pluginName?: string;
  actorId: string;
  description?: string;
  autoEnableProjectId?: string;
}): Promise<{ name: string; description?: string }>

/** 从本地路径安装技能（内部自动验证名称）。 */
installFromLocalSource(input: {
  localPath: string; pluginName: string; projectId?: string;
}): Promise<{ name: string; description?: string }>

/** 检查本地技能源文件。 */
inspectLocalSource(input: {
  localPath: string; sourceType: string;
  preferredPluginName?: string; extractionDir?: string;
}): Promise<{
  resolvedPluginName: string; resolvedLocalPath: string;
  manifestName?: string; manifestDescription?: string;
}>

/** 分配技能暂存目录。 */
allocateStagingDir(scope: string, userId: string): Promise<string>
```

---

## §9 审批回调

```typescript
/** 处理审批回调。 */
handleApprovalCallback(input: {
  approvalId: string;
  decision: "accept" | "decline" | "approve_always";
}): Promise<"resolved" | "duplicate">
```

---

## §Error 错误契约

> [!IMPORTANT]
> 所有 L2 API 在失败时抛出 `OrchestratorError`。L1 统一 catch 后根据 `code` 渲染错误提示。

```typescript
class OrchestratorError extends Error {
  readonly code: ErrorCodeValue;
  readonly meta?: Record<string, unknown>;
}
```

### 错误码分组

| 分组 | 错误码 | 含义 | 触发 API |
|------|--------|------|---------|
| **Turn 状态** | `TURN_ALREADY_RUNNING` | 线程正在执行 turn | `createTurn` |
| | `APPROVAL_PENDING` | 线程等待审批 | `createTurn` |
| | `ILLEGAL_TRANSITION` | 状态机非法转换 | `createTurn`, `interruptTurn` |
| **线程** | `THREAD_NOT_FOUND` | 线程不存在 | `joinThread`, `deleteThread`, `getThreadRecord` |
| | `THREAD_ALREADY_EXISTS` | 线程名已占用 | `createThread` |
| | `THREAD_BINDING_REQUIRED` | 用户未绑定线程 | `createTurn` |
| | `NO_ACTIVE_THREAD` | 用户无活跃线程 | `createTurn`, `interruptTurn` |
| | `THREAD_NAME_REQUIRED` | 缺少线程名 | `createThread` |
| **项目** | `PROJECT_NOT_FOUND` | 项目不存在 | 所有需 `requiresProject` 的 API |
| **后端** | `AGENT_API_UNAVAILABLE` | 后端会话不可用 | `createTurn`, `respondUserInput` |
| | `RESUME_NOT_SUPPORTED` | 后端不支持会话恢复 | `recoverSessions`（内部） |
| **Snapshot** | `SNAPSHOT_NOT_FOUND` | 快照不存在 | `jumpToSnapshot` |
| | `SNAPSHOT_REPO_MISSING` | 快照仓库未初始化 | `listSnapshots`, `jumpToSnapshot` |
| **Merge** | `MERGE_IN_PROGRESS` | 合并进行中（不能重复） | `handleMerge` |
| | `MERGE_NO_CHANGES` | 无变更可合并 | `handleMerge` |
| | `BRANCH_NAME_REQUIRED` | 缺少分支名 | `handleMerge`, `handleMergePreview` |
| | `WORKTREE_DIRTY` | worktree 有未提交变更 | `handleMerge` |
| **Turn 数据** | `TURN_RECORD_MISSING` | turn 记录不存在 | `getTurnDetail`, `acceptTurn` |
| | `TURN_DETAIL_MISSING` | turn 详情不存在 | `getTurnDetail` |
| **[待删除]** | ~~`UNSUPPORTED_INTENT`~~ | intent 层使用（上移 L1 后删除） | — |

---

## §Output 输出契约（路径 B）

> [!IMPORTANT]
> 路径 B 是 L2 → L1 的**事件推送通道**，与路径 A（API 调用）同等重要。
> L1 通过 `runStartup(gateway)` 注入 `OutputGateway`，L2 内部 EventPipeline 通过它推送事件。

```typescript
/** L1 提供给 L2 的唯一回调接口。
 *  L2 用 projectId 标识推送目标，L1 负责 projectId → chatId 反向映射。 */
interface OutputGateway {
  dispatch(projectId: string, output: PlatformOutput): Promise<void>;
}
```

### PlatformOutput 类型分组（L2 产出）

> [!IMPORTANT]
> 所有 `PlatformOutput` variant 使用独立自定义类型，L1 通过 discriminated union 安全匹配。

```typescript
/** 新增类型（补充到 services/contracts/im/ 中）。 */
interface IMError {
  code: string;           // ErrorCode 或自定义
  message: string;
  source: "agent" | "orchestrator";
  turnId?: string;
}

type IMMergeEvent =
  | { action: "resolver_done"; projectId: string; branchName: string;
      review: IMFileMergeReview }
  | { action: "resolver_complete"; data: IMThreadMergeOperation }
  | { action: "timeout"; projectId: string; branchName: string };
```

| 分组 | `kind` | 数据类型 | 触发来源 |
|------|--------|---------|---------|
| **流式内容** | `content` | `IMContentChunk` | `content_delta` 事件 |
| | `reasoning` | `IMReasoningChunk` | `reasoning_delta` 事件 |
| | `plan` | `IMPlanChunk` | `plan_delta` 事件 |
| | `plan_update` | `IMPlanUpdate` | `plan_update` 事件 |
| | `tool_output` | `IMToolOutputChunk` | `tool_output` 事件 |
| | `progress` | `IMProgressEvent` | `tool_begin`/`tool_end` 事件 |
| **交互请求** | `approval_request` | `IMApprovalRequest` | `approval_request` 事件 |
| | `user_input_request` | `IMUserInputRequest` | `user_input` 事件 |
| **通知** | `notification` | `IMNotification` | `notification` 事件 + 原 `text` 消息 |
| **错误** | `error` | `IMError` | agent 运行时错误 / L2 异步错误 |
| **Turn 结果** | `turn_summary` | `IMTurnSummary` | `turn_complete` 事件 |
| **Merge（异步）** | `merge_event` | `IMMergeEvent` | agent 冲突解析 / resolver 完成 / 超时 |

> [!NOTE]
> 以下类型当前定义在 `PlatformOutput` 联合中，但实际由 **L1 自行构建并 dispatch**，不是 L2 产出。
> 目标状态应从 `PlatformOutput` 移出，改为 L1 本地类型：
> - `thread_new_form`、`thread_operation` — 线程 UI 表单
> - `snapshot_operation`、`config_operation`、`skill_operation` — 操作反馈
> - `help_panel`、`turn_detail`、`admin_panel` — UI 面板

### L1 消费 PlatformOutput 示例

```typescript
// L1: FeishuOutputAdapter — 实现 OutputGateway
class FeishuOutputAdapter implements OutputGateway {
  async dispatch(projectId: string, output: PlatformOutput): Promise<void> {
    // 1. projectId → chatId 反向映射（L1 职责）
    const chatId = this.projectChatMap.get(projectId);
    if (!chatId) return;

    // 2. 根据 kind 分发到平台渲染
    switch (output.kind) {
      case "content":
        await this.appendToStreamCard(chatId, output.data);
        break;
      case "approval_request":
        await this.sendApprovalCard(chatId, output.data);
        break;
      case "turn_summary":
        await this.finalizeStreamCard(chatId, output.data);
        break;
      case "merge_event":
        switch (output.data.action) {
          case "resolver_done":   await this.refreshMergeReviewCard(chatId, output.data); break;
          case "resolver_complete": await this.sendMergePreviewCard(chatId, output.data); break;
          case "timeout":         await this.sendMergeTimeoutNotice(chatId, output.data); break;
        }
        break;
      // ... 其他 kind 处理
    }
  }
}

---

## L1 调用模式

> [!IMPORTANT]
> **意图解析是 L1 的职责**。L2 不感知 `/push`、`/sync`、`/plan` 等斜杠命令。
> L1 解析用户消息后，调用对应的 §0–§9 API。

| 层级 | 职责 |
|------|------|
| **L1** | 解析平台消息 → `routeIntent()` → 调用 §0–§9 API |
| **L2** | 纯业务执行，不感知意图解析 |

```typescript
// L1 意图路由示例
const projectId = api.resolveProjectId(chatId);
const intent = routeIntent(message);

switch (intent.type) {
  case "TURN_START":
    await api.createTurn({ projectId, userId, text, traceId });
    break;
  case "THREAD_NEW":
    await api.createThread({ projectId, userId, threadName, backendId, model });
    break;
  case "MERGE_PREVIEW": {
    const result = await api.handleMergePreview({ projectId, branchName });
    switch (result.kind) {
      case "preview": renderMergePreviewCard(chatId, result); break;
      case "conflict": renderConflictCard(chatId, result); break;
    }
    break;
  }
}
```

### L1 斜杠命令 → L2 API 映射

> L1 负责解析斜杠命令并转化为 L2 API 调用。

| 斜杠命令 | L1 调用的 L2 API | 说明 |
|---------|------------------|------|
| `/push` | `api.pushWorkBranch(projectId)` | 推送 workBranch 到远程 |
| `/sync` | `api.detectStaleThreads({ projectId, mergedThreadName })` | 检测过期线程 |
| `/sync-reset {name}` | `api.deleteThread({ projectId, threadName: name })` | 删除并重建线程 |
| `/plan {text}` | `api.createTurn({ projectId, userId, text, mode: "plan" })` | plan 模式发起 turn |
| `/thread new {name}` | `api.createThread({ projectId, userId, threadName: name, ... })` | 创建新线程 |
| `/thread join {name}` | `api.joinThread({ projectId, userId, threadName: name })` | 切换线程 |
| `/thread leave` | `api.leaveThread({ projectId, userId })` | 离开线程 |
| `/thread list` | `api.listThreads(projectId)` | 列出线程 |
| `/merge {branch}` | `api.handleMerge({ projectId, branchName: branch })` | 执行合并 |
| `/skill install {name}` | `api.installSkill({ source: name, projectId, userId })` | 安装技能 |
| `/skill remove {name}` | `api.removeSkill({ name, projectId })` | 移除技能 |

---

## CoreDeps 精简目标

```diff
  interface PlatformModuleContext {
    config: AppConfig;
-   db: DatabaseSync;
-   persistence: PersistenceLayer;
    layer: OrchestratorLayer;
  }

  interface CoreDeps {
    config: AppConfig;
-   orchestrator: OrchestratorLike;
-   pluginService: PluginServiceLike;
-   approvalHandler: ApprovalHandlerLike;
-   adminStateStore: AdminStateStoreLike;
-   findProjectByChatId(chatId: string): ProjectRecord | null;
-   userRepository: UserRepository;
-   roleResolver: RoleResolver;
+   api: OrchestratorApi;
  }
```

## L1 允许的 import

```
✅ services/index                   (OrchestratorLayer + re-export 类型)
✅ services                         (目录 import，解析到 services/index.ts)
✅ packages/logger                  (跨切面)
❌ services/**                      (内部子模块；排除 services/index)
❌ packages/agent-core/
```
