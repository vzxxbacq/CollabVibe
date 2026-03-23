import type { PlatformAction, PlatformActionAdapter } from "../../common/platform-action";

interface SlackInboundActionLike {
  chatId?: string;
  userId?: string;
  action?: string;
  messageTs?: string;
  callId?: string;
  turnId?: string;
  threadId?: string;
  approvalType?: "command_exec" | "file_change";
  branchName?: string;
  baseBranch?: string;
  filePath?: string;
  prompt?: string;
}

export class SlackActionAdapter implements PlatformActionAdapter {
  toAction(event: unknown): PlatformAction | null {
    const input = event as SlackInboundActionLike;
    const chatId = String(input.chatId ?? "");
    const actorId = String(input.userId ?? "");
    const action = String(input.action ?? "");
    if (!chatId || !actorId || !action) return null;

    const base = { platform: "slack" as const, chatId, actorId, raw: event };
    if (action === "interrupt") return { kind: "turn_interrupt", turnId: input.turnId, ...base };
    if (action === "accept_changes") return { kind: "turn_accept", turnId: String(input.turnId ?? ""), ...base };
    if (action === "revert_changes") return { kind: "turn_revert", turnId: String(input.turnId ?? ""), ...base };
    if (action === "approve" || action === "deny" || action === "approve_always") {
      return {
        kind: "approval_decision",
        approvalId: String(input.callId ?? ""),
        decision: action,
        threadId: input.threadId,
        turnId: input.turnId,
        approvalType: input.approvalType,
        ...base,
      };
    }
    if (action === "confirm_merge") return { kind: "merge_confirm", branchName: String(input.branchName ?? ""), ...base };
    if (action === "cancel_merge") return { kind: "merge_cancel", branchName: String(input.branchName ?? ""), baseBranch: input.baseBranch, ...base };
    if (action === "merge_cancel") return { kind: "merge_review_cancel", branchName: String(input.branchName ?? ""), baseBranch: input.baseBranch, ...base };
    if (action === "merge_accept_all") return { kind: "merge_accept_all", branchName: String(input.branchName ?? ""), ...base };
    if (action === "merge_agent_assist_submit") return { kind: "merge_agent_assist", branchName: String(input.branchName ?? ""), prompt: input.prompt, ...base };
    if (action === "merge_commit") return { kind: "merge_commit", branchName: String(input.branchName ?? ""), ...base };
    if (action === "help_thread_new") return { kind: "help_thread_new", messageId: input.messageTs, ...base };
    if (action === "help_home" || action === "help_threads" || action === "help_history" || action === "help_skills" || action === "help_backends" || action === "help_turns") {
      return { kind: "help_panel", panel: action, messageId: input.messageTs, ...base };
    }
    if (action === "merge_accept" || action === "merge_keep_main" || action === "merge_use_branch" || action === "merge_skip") {
      const decisionMap = {
        merge_accept: "accept",
        merge_keep_main: "keep_main",
        merge_use_branch: "use_branch",
        merge_skip: "skip",
      } as const;
      return {
        kind: "merge_file_decision",
        branchName: String(input.branchName ?? ""),
        filePath: String(input.filePath ?? ""),
        decision: decisionMap[action],
        ...base,
      };
    }
    return { kind: "raw", actionId: action, ...base };
  }
}
