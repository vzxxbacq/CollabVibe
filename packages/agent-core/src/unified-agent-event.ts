export type UnifiedAgentTool =
  | "exec_command"
  | "mcp_tool"
  | "web_search"
  | "image_gen"
  | "patch_apply"
  | "collab_agent";

export type UnifiedToolOutputFormat = "text" | "binary" | "mixed";

export type UnifiedAgentEvent =
  | { type: "content_delta"; turnId?: string; delta: string }
  | { type: "reasoning_delta"; turnId?: string; delta: string }
  | { type: "plan_delta"; turnId?: string; delta: string }
  | {
    type: "plan_update";
    turnId?: string;
    explanation?: string;
    plan: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
  }
  | {
    type: "tool_output";
    turnId?: string;
    callId: string;
    delta: string;
    source: "stdout" | "stderr" | "stdin";
    format?: UnifiedToolOutputFormat;
    byteLength?: number;
  }
  | {
    type: "tool_begin" | "tool_end";
    turnId?: string;
    callId?: string;
    tool: UnifiedAgentTool;
    label: string;
    status?: "success" | "failed";
    exitCode?: number;
    duration?: string;
    summary?: string;
    output?: string;
    targetFile?: string;
    agentId?: string;
  }
  | {
    type: "approval_request";
    turnId: string;
    approvalId: string;
    backendApprovalId?: string;
    callId: string;
    approvalType: "command_exec" | "file_change";
    description: string;
    displayName?: string;
    summary?: string;
    reason?: string;
    cwd?: string;
    files?: string[];
    command?: string[];
    changes?: Record<string, unknown>;
    availableActions?: Array<"approve" | "deny" | "approve_always">;
    backendType?: "codex" | "acp";
    optionMap?: Record<string, string>;
  }
  | { type: "user_input"; turnId: string; callId: string; questions: Array<{ id?: string; text: string; options?: string[] }> }
  | { type: "turn_started"; turnId?: string; title?: string }
  | { type: "turn_complete"; turnId?: string; lastAgentMessage?: string }
  | { type: "turn_aborted"; turnId?: string; title?: string }
  | { type: "token_usage"; turnId?: string; input: number; output: number; total?: number }
  | {
    type: "notification";
    turnId?: string;
    category:
    | "agent_message"
    | "error"
    | "warning"
    | "model_reroute"
    | "context_compacted"
    | "undo_started"
    | "undo_completed"
    | "deprecation";
    title: string;
    detail?: string;
    lastAgentMessage?: string;
  };
