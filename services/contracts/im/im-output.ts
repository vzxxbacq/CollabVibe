// ─────────────────────────────────────────────────────────────────────────────
// IM Output Data Types — Codex 事件 → 平台渲染 数据载荷
// ─────────────────────────────────────────────────────────────────────────────
//
// 设计目标：
//   定义 PlatformOutput.data 的内部载荷类型。
//   这些纯数据类型被 OutputGateway.dispatch(PlatformOutput) 携带，
//   由各平台的 OutputGateway 实现（FeishuOutputGateway, SlackOutputGateway）
//   内部消费并渲染为平台 UI。
//
// 数据流：
//   Codex Event → EventTransformer → IMOutputMessage
//     → AgentEventRouter → toPlatformOutput() → PlatformOutput
//       → OutputGateway.dispatch(chatId, PlatformOutput)
//         → FeishuOutputGateway / SlackOutputGateway (内部渲染)
//
// ─────────────────────────────────────────────────────────────────────────────

// ── 流式内容类型 ─────────────────────────────────────────────────────────────

/** Agent 最终回复增量 (agent_message_content_delta) */
export interface IMContentChunk {
  kind: "content";
  turnId: string;
  delta: string;
}

/** 推理/思考增量 (agent_reasoning_delta, reasoning_content_delta, reasoning_raw_content_delta) */
export interface IMReasoningChunk {
  kind: "reasoning";
  turnId: string;
  delta: string;
}

/** 执行计划增量 (plan_delta) */
export interface IMPlanChunk {
  kind: "plan";
  turnId: string;
  delta: string;
}

/** 结构化计划更新 (plan_update / update_plan tool) */
export interface IMPlanUpdate {
  kind: "plan_update";
  turnId: string;
  explanation?: string;
  plan: Array<{
    step: string;
    status: "pending" | "in_progress" | "completed";
  }>;
}

/** 工具输出增量 (exec_command_output_delta, terminal_interaction) — 含 base64 解码后的文本 */
export interface IMToolOutputChunk {
  kind: "tool_output";
  turnId: string;
  callId: string;
  delta: string;
  source: "stdout" | "stdin";
}

// ── 工具进度 ─────────────────────────────────────────────────────────────────

/** 工具执行 begin/end 生命周期事件 — 统一 exec_command/mcp_tool/web_search/image_gen/patch_apply/collab_agent */
export interface IMProgressEvent {
  kind: "progress";
  turnId: string;
  phase: "begin" | "end";
  tool: "exec_command" | "mcp_tool" | "web_search" | "image_gen" | "patch_apply" | "collab_agent";
  label: string;
  callId?: string;
  status?: "success" | "failed";
  exitCode?: number;
  duration?: string;
  summary?: string;
  targetFile?: string;
  agentId?: string;
}

// ── 交互请求 ─────────────────────────────────────────────────────────────────

/** 审批请求 (exec_approval_request, apply_patch_approval_request) */
export interface IMApprovalRequest {
  kind: "approval";
  threadId: string;
  turnId: string;
  threadName?: string;
  approvalId: string;
  callId: string;
  approvalType: "command_exec" | "file_change";
  description: string;
  createdAt?: string;
  command?: string[];
  changes?: Record<string, unknown>;
  availableActions: Array<"approve" | "deny" | "approve_always">;
}

/** 用户输入请求 (request_user_input, elicitation_request) */
export interface IMUserInputRequest {
  kind: "user_input";
  threadId: string;
  turnId: string;
  threadName?: string;
  callId: string;
  questions: Array<{
    id?: string;
    text: string;
    options?: string[];
  }>;
}

// ── 通知 ─────────────────────────────────────────────────────────────────────

/** 系统通知 — 错误/警告/状态变更 */
export interface IMNotification {
  kind: "notification";
  threadId: string;
  turnId?: string;
  category:
  | "turn_started"
  | "turn_complete"
  | "turn_aborted"
  | "agent_message"
  | "error"
  | "warning"
  | "token_usage"
  | "model_reroute"
  | "context_compacted"
  | "undo_started"
  | "undo_completed"
  | "deprecation"
  | "skills_changed";
  title: string;
  detail?: string;
  lastAgentMessage?: string;
  tokenUsage?: { input: number; output: number; total?: number };
}



// ── Turn 摘要 ────────────────────────────────────────────────────────────────

/** Turn 完成汇总 — 在 finishTurn 中由 commitAndDiffWorktreeChanges 填充文件变更 */
export interface IMTurnSummary {
  kind: "turn_summary";
  threadId: string;
  threadName?: string;
  turnId: string;
  filesChanged: string[];
  fileChangeDetails?: Array<{
    diffSummary: string;
    filesChanged: string[];
    stats: { additions: number; deletions: number };
  }>;
  tokenUsage?: { input: number; output: number; total?: number };
  duration?: number;
  lastAgentMessage?: string;
}

// ── Thread 管理 ──────────────────────────────────────────────────────────────

/** Thread 管理操作结果 — 由 orchestrator 产生，渠道层渲染对应 UI */
export interface IMThreadOperation {
  kind: "thread_operation";
  action: "created" | "joined" | "left" | "listed" | "resumed";
  /** 当前操作的线程（created/joined/resumed 时有值） */
  thread?: { threadId: string; threadName: string };
  /** 线程列表（listed 时有值） */
  threads?: Array<{
    threadName: string;
    threadId?: string;
    active?: boolean;
    status?: "creating" | "active";
    backendName?: string;
    modelName?: string;
  }>;
}

// ── 配置操作 ──────────────────────────────────────────────────────────────

/** 模型/后端配置操作结果 */
export interface IMConfigOperation {
  kind: "config_operation";
  action: "model_set" | "model_list";
  currentModel?: string;
  availableModels?: string[];
  threadName?: string;
}

/** Thread 创建表单所需的后端/模型数据 */
export interface IMThreadNewFormData {
  kind: "thread_new_form";
  backends: Array<{ name: string; description?: string; models?: string[] }>;
  defaultBackend?: string;
  defaultModel?: string;
}

/** Thread 创建结果 — 用于展示创建成功反馈 */
export interface IMThreadCreatedResult {
  kind: "thread_created_result";
  threadName: string;
  threadId: string;
  backendName?: string;
  modelName?: string;
}

// ── 快照管理 ──────────────────────────────────────────────────────────────

/** 单个 Turn 快照记录 — 用于历史列表展示 */
export interface IMTurnSnapshot {
  turnId: string;
  turnIndex: number;
  agentSummary?: string;
  filesChanged?: string[];
  createdAt: string;
  isCurrent: boolean;
}

/** 快照管理操作结果 — 由 orchestrator 产生，渠道层渲染时间线 UI */
export interface IMSnapshotOperation {
  kind: "snapshot_operation";
  action: "listed" | "jumped";
  /** 所属线程 ID（"__main__" 表示主分支 merge 历史） */
  threadId?: string;
  /** 所属线程显示名（用于 card header） */
  threadName?: string;
  /** listed 时的快照列表 */
  snapshots?: IMTurnSnapshot[];
  /** jumped 时的目标快照 */
  target?: IMTurnSnapshot;
  /** jumped 时是否上下文已重置 */
  contextReset?: boolean;
}

// ── Thread 合并 ──────────────────────────────────────────────────────────────

/** Thread 合并操作结果 — 由 orchestrator 产生，渠道层渲染合并反馈 UI */
export interface IMThreadMergeOperation {
  kind: "thread_merge";
  /** 合并阶段: preview=预览等待审批, success=已合并, conflict=有冲突, rejected=已取消 */
  action: "preview" | "success" | "conflict" | "rejected";
  /** 被合并的分支名 */
  branchName: string;
  /** 基线分支名 */
  baseBranch: string;
  /** 描述信息 */
  message: string;
  /** diff 统计（preview/success 时有值） */
  diffStats?: { additions: number; deletions: number; filesChanged: string[]; fileDiffs?: Array<{ file: string; diff: string }> };
  /** 冲突文件列表（conflict 时有值） */
  conflicts?: string[];
  /** 冲突解决线程（conflict 时自动创建） */
  resolverThread?: { threadName: string; threadId: string };
}

// ── Per-File Merge Review ────────────────────────────────────────────────────

/** 文件在 merge --no-commit 后的状态 */
export type MergeFileStatus = "auto_merged" | "conflict" | "added" | "deleted" | "agent_resolved" | "agent_pending";

/** 用户对单个文件的决策 */
export type MergeFileDecision = "accept" | "keep_main" | "use_branch" | "skip";

/** 单文件合并审阅事件 — 由 orchestrator 产生，渠道层渲染 per-file review UI */
export interface IMFileMergeReview {
  kind: "file_merge_review";
  branchName: string;
  baseBranch: string;
  sessionState: "reviewing" | "resolving" | "recovery_required";
  resolverBackendId?: string;
  resolverModel?: string;
  /** 当前审阅文件 (0-indexed) */
  fileIndex: number;
  /** 总文件数 */
  totalFiles: number;
  /** 当前文件信息 */
  file: {
    path: string;
    diff: string;
    status: MergeFileStatus;
  };
  /** 该文件可用的决策（由 status 派生） */
  availableDecisions: MergeFileDecision[];
  /** 审阅总览，用于渠道层渲染总览与批量动作 */
  overview: {
    decided: number;
    pending: number;
    pendingConflicts: number;
    pendingDirect: number;
    agentPending: number;
    accepted: number;
    keptBase: number;
    usedBranch: number;
    skipped: number;
  };
  /** 待处理队列摘要 */
  queues: {
    conflictPaths: string[];
    directPaths: string[];
    agentPendingPaths: string[];
  };
  recoveryError?: string;
  /** 已完成的审阅进度 */
  progress: { accepted: number; rejected: number; remaining: number };
}

/** 用户对单文件的决策（channel-core 抽象层） */
export interface IMMergeFileDecision {
  kind: "merge_file_decision";
  filePath: string;
  decision: MergeFileDecision;
}

/** reject 带 prompt — 触发 Agent 重试（channel-core 抽象层） */
export interface IMMergeFileRejectWithPrompt {
  kind: "merge_file_reject";
  filePath: string;
  prompt: string;
}

/** 合并汇总 — 所有文件审阅完毕后展示，渠道层渲染汇总 UI */
export interface IMMergeSummary {
  kind: "merge_summary";
  branchName: string;
  baseBranch: string;
  files: Array<{ path: string; decision: MergeFileDecision; status: MergeFileStatus }>;
  /** 是否有文件被 skip/keep_main/use_branch（非 accept） */
  hasPartialMerge: boolean;
}

// ── Skill 管理 ──────────────────────────────────────────────────────────────

/** Skill 信息（语义层，与 UI 无关） */
export interface IMSkillInfo {
  name: string;
  description: string;
  installed: boolean;
}

/** Skill 操作语义事件 — 由 server 产生，渠道层按平台特性渲染 */
export interface IMSkillOperation {
  kind: "skill_operation";
  action:
  | "form"               // 展示可安装 skill 列表（含交互）
  | "installed"          // 安装成功反馈
  | "removed"            // 移除成功反馈
  | "admin_placeholder"  // admin 功能暂未实现
  | "error";             // 错误
  /** form → 可用 skill 列表 */
  skills?: IMSkillInfo[];
  /** installed/removed → 操作的目标 */
  skill?: IMSkillInfo;
  /** error → 错误信息 */
  error?: string;
}

// ── Admin 管理 ──────────────────────────────────────────────────────────────

/** Admin DM 管理命令定义 */
export interface IMAdminHelpCommand {
  command: string;
  description: string;
  /** 此命令仅限 DM 使用 */
  dmOnly: boolean;
}

/** Admin 管理帮助 — 私聊场景展示管理员可用命令 */
export interface IMAdminHelpData {
  kind: "admin_help";
  commands: IMAdminHelpCommand[];
}

/** Admin 项目面板 — 项目/chat/git/成员关系表 */
export interface IMAdminProjectPanel {
  kind: "admin_project";
  projects: Array<{
    id: string;
    name: string;
    chatId: string;
    cwd: string;
    gitUrl?: string;
    status: string;
    memberCount: number;
  }>;
}

/** Admin 系统用户面板 — 所有注册用户 + 分页 */
export interface IMAdminUserPanel {
  kind: "admin_user";
  users: Array<{ userId: string; displayName?: string; sysRole: 0 | 1; source: "env" | "im" }>;
  total: number;
  page: number;
  pageSize: number;
}

/** Admin 项目成员面板 — 按项目的成员列表 */
export interface IMAdminMemberPanel {
  kind: "admin_member";
  /** 按项目分组的成员列表 */
  projects: Array<{
    projectName: string;
    projectId: string;
    chatId?: string;
    members: Array<{ userId: string; displayName?: string; role: string }>;
  }>;
}

/** Admin Skill 面板 — 允许列表 + 添加表单 */
export interface IMAdminSkillPanel {
  kind: "admin_skill";
  projectId?: string;
  projectName?: string;
  installTasks?: Array<{
    taskId: string;
    label: string;
    status: "running" | "success" | "failed";
    detail?: string;
  }>;
  plugins: Array<{
    pluginName: string;
    sourceType: string;
    name?: string;
    description?: string;
    downloaded: boolean;
    enabled: boolean;
    hasMcpServers: boolean;
    addedBy?: string;
    downloadedAt?: string;
  }>;
}

/** Admin 后端配置面板 */
export interface IMAdminBackendPanel {
  kind: "admin_backend";
  backends: Array<{
    name: string;
    serverCmd: string;
    cmdAvailable: boolean;
    configPath: string;
    configExists: boolean;
    activeProvider?: string;
    /** Policy fields read from the backend's config file */
    policy?: Record<string, string>;
    providers: Array<{
      name: string;
      baseUrl?: string;
      apiKeyEnv?: string;
      apiKeySet: boolean;
      apiKeyMasked?: string;  // e.g. "sk-***a1b2"
      isActive: boolean;
      models: Array<{
        name: string;
        available: boolean | null;
        checkedAt?: string;
        isCurrent: boolean;
      }>;
    }>;
    /** Model profiles (presets) — name + model + provider + extras */
    profiles?: Array<{
      name: string;
      model: string;
      provider: string;
      extras: Record<string, unknown>;
    }>;
  }>;
}

// ── 联合类型 ─────────────────────────────────────────────────────────────────

/** event-transformer 的输出类型 — AgentEventRouter 使用此类型做 switch dispatch */
export type IMOutputMessage =
  | IMContentChunk
  | IMReasoningChunk
  | IMPlanChunk
  | IMPlanUpdate
  | IMToolOutputChunk
  | IMProgressEvent
  | IMApprovalRequest
  | IMUserInputRequest
  | IMNotification
  | IMTurnSummary
  | IMMergeReviewMessage
  | IMMergeSummaryMessage
  | IMMergeTimeoutMessage;

/** Path B merge event: per-file review ready */
export interface IMMergeReviewMessage { kind: "merge_review"; review: IMFileMergeReview; }
/** Path B merge event: all files decided, summary ready */
export interface IMMergeSummaryMessage { kind: "merge_summary"; summary: IMMergeSummary; }
/** Path B merge event: session timed out */
export interface IMMergeTimeoutMessage { kind: "merge_timeout"; chatId: string; branchName: string; }


