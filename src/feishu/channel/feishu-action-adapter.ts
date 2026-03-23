import type { PlatformAction, PlatformActionAdapter } from "../../../services/contracts/im/platform-action";

interface FeishuCardActionPayload {
  action?: {
    value?: Record<string, unknown>;
    form_value?: Record<string, string>;
  };
  operator?: { open_id?: string };
  context?: { open_chat_id?: string; open_message_id?: string };
}

export class FeishuActionAdapter implements PlatformActionAdapter {
  toAction(event: unknown): PlatformAction | null {
    const payload = event as FeishuCardActionPayload;
    const actionValue = payload.action?.value ?? {};
    const action = String(actionValue.action ?? "");
    const chatId = String(payload.context?.open_chat_id ?? "");
    const actorId = String(payload.operator?.open_id ?? "");
    if (!chatId || !actorId || !action) return null;

    const base = { platform: "feishu" as const, chatId, actorId, raw: event };
    if (action === "interrupt") return { kind: "turn_interrupt", turnId: typeof actionValue.turnId === "string" ? actionValue.turnId : undefined, threadName: typeof actionValue.threadName === "string" ? actionValue.threadName : undefined, ...base };
    if (action === "create_thread") {
      const formValue = payload.action?.form_value ?? {};
      const backendModelRaw = String(formValue.backend_model ?? actionValue.backend_model ?? "").trim();
      const colonIdx = backendModelRaw.indexOf(":");
      const selectedBackend = colonIdx >= 0 ? backendModelRaw.slice(0, colonIdx) : backendModelRaw;
      const afterColon = colonIdx >= 0 ? backendModelRaw.slice(colonIdx + 1) : "";
      const secondColon = afterColon.indexOf(":");
      const model = secondColon >= 0 ? afterColon.slice(secondColon + 1) : afterColon;
      return {
        kind: "thread_create",
        threadName: String(formValue.thread_name ?? actionValue.thread_name ?? "").trim(),
        backendId: selectedBackend || undefined,
        model: model || undefined,
        ...base,
      };
    }
    if (action === "help_create_thread") {
      const formValue = payload.action?.form_value ?? {};
      const backendModelRaw = String(formValue.backend_model ?? actionValue.backend_model ?? "").trim();
      const colonIdx = backendModelRaw.indexOf(":");
      const selectedBackend = colonIdx >= 0 ? backendModelRaw.slice(0, colonIdx) : backendModelRaw;
      const afterColon = colonIdx >= 0 ? backendModelRaw.slice(colonIdx + 1) : "";
      const secondColon = afterColon.indexOf(":");
      const model = secondColon >= 0 ? afterColon.slice(secondColon + 1) : afterColon;
      return {
        kind: "thread_create",
        threadName: String(formValue.thread_name ?? actionValue.thread_name ?? "").trim(),
        backendId: selectedBackend || undefined,
        model: model || undefined,
        ...base,
      };
    }
    if (action === "help_switch_thread") {
      return { kind: "thread_join", threadName: String(actionValue.threadName ?? ""), fromHelp: true, ...base };
    }
    if (action === "help_switch_to_main") {
      return { kind: "thread_leave", fromHelp: true, ...base };
    }
    if (action === "accept_changes" && typeof actionValue.turnId === "string") return { kind: "turn_accept", turnId: actionValue.turnId, ...base };
    if (action === "revert_changes" && typeof actionValue.turnId === "string") return { kind: "turn_revert", turnId: actionValue.turnId, ...base };
    if (action === "approve" || action === "deny" || action === "approve_always") {
      return {
        kind: "approval_decision",
        approvalId: String(actionValue.approvalId ?? ""),
        decision: action,
        threadId: typeof actionValue.threadId === "string" ? actionValue.threadId : undefined,
        turnId: typeof actionValue.turnId === "string" ? actionValue.turnId : undefined,
        approvalType: actionValue.approvalType as "command_exec" | "file_change" | undefined,
        ...base,
      };
    }
    if (action === "user_input_submit") {
      return {
        kind: "user_input_reply",
        callId: String(actionValue.callId ?? ""),
        ...base,
      };
    }
    if (action === "switch_thread") {
      return { kind: "thread_join", threadName: String(actionValue.threadName ?? ""), ...base };
    }
    if (action === "switch_to_main") {
      return { kind: "thread_leave", ...base };
    }
    if (action === "confirm_merge") return { kind: "merge_confirm", branchName: String(actionValue.branchName ?? ""), ...base };
    if (action === "cancel_merge") return { kind: "merge_cancel", branchName: String(actionValue.branchName ?? ""), baseBranch: typeof actionValue.baseBranch === "string" ? actionValue.baseBranch : undefined, ...base };
    if (action === "merge_cancel") return { kind: "merge_review_cancel", branchName: String(actionValue.branchName ?? ""), baseBranch: typeof actionValue.baseBranch === "string" ? actionValue.baseBranch : undefined, ...base };
    if (action === "merge_start_review") return { kind: "merge_review_start", branchName: String(actionValue.branchName ?? ""), baseBranch: typeof actionValue.baseBranch === "string" ? actionValue.baseBranch : undefined, ...base };
    if (action === "help_merge_preview") return { kind: "merge_preview", branchName: String(actionValue.branchName ?? ""), ...base };
    if (action === "merge_reject") return { kind: "merge_retry_file", branchName: String(actionValue.branchName ?? ""), filePath: String(actionValue.filePath ?? ""), ...base };
    if (action === "merge_open_file_detail") return { kind: "merge_review_open_file_detail", branchName: String(actionValue.branchName ?? ""), ...base };
    if (action === "merge_back_overview") return { kind: "merge_review_back_overview", branchName: String(actionValue.branchName ?? ""), ...base };
    if (action === "merge_agent_assist_form") return { kind: "merge_review_agent_assist_form", branchName: String(actionValue.branchName ?? ""), ...base };
    if (action === "merge_accept_all") return { kind: "merge_accept_all", branchName: String(actionValue.branchName ?? ""), ...base };
    if (action === "merge_agent_assist_submit") return { kind: "merge_agent_assist", branchName: String(actionValue.branchName ?? ""), prompt: typeof actionValue.prompt === "string" ? actionValue.prompt : undefined, ...base };
    if (action === "merge_batch_retry") {
      const formValue = payload.action?.form_value ?? {};
      const files = Array.isArray(formValue.batch_retry_files) ? formValue.batch_retry_files.map(String) : [];
      const feedback = typeof formValue.batch_retry_feedback === "string" ? formValue.batch_retry_feedback : "";
      return { kind: "merge_batch_retry", branchName: String(actionValue.branchName ?? ""), files, feedback, ...base };
    }
    if (action === "merge_commit") return { kind: "merge_commit", branchName: String(actionValue.branchName ?? ""), ...base };
    if (action === "keep_merged_thread") return { kind: "keep_merged_thread", branchName: String(actionValue.branchName ?? ""), ...base };
    if (action === "delete_merged_thread") return { kind: "delete_merged_thread", branchName: String(actionValue.branchName ?? ""), projectId: String(actionValue.projectId ?? ""), ...base };
    if (action === "view_file_changes" || action === "file_changes_page") {
      return {
        kind: "turn_view_file_changes",
        turnId: String(actionValue.turnId ?? ""),
        page: typeof actionValue.page === "number" ? actionValue.page : Number(actionValue.page ?? 0),
        targetChatId: typeof actionValue.chatId === "string" ? actionValue.chatId : undefined,
        ...base,
      };
    }
    if (action === "file_changes_back") {
      return {
        kind: "turn_file_changes_back",
        turnId: String(actionValue.turnId ?? ""),
        targetChatId: typeof actionValue.chatId === "string" ? actionValue.chatId : undefined,
        ...base,
      };
    }
    if (action === "view_tool_progress" || action === "tool_progress_page") {
      return {
        kind: "turn_view_tool_progress",
        turnId: String(actionValue.turnId ?? ""),
        page: typeof actionValue.page === "number" ? actionValue.page : Number(actionValue.page ?? 0),
        targetChatId: typeof actionValue.chatId === "string" ? actionValue.chatId : undefined,
        ...base,
      };
    }
    if (action === "tool_progress_back") {
      return {
        kind: "turn_tool_progress_back",
        turnId: String(actionValue.turnId ?? ""),
        targetChatId: typeof actionValue.chatId === "string" ? actionValue.chatId : undefined,
        ...base,
      };
    }
    if (action === "view_turn_detail") {
      return {
        kind: "turn_view_detail",
        turnId: String(actionValue.turnId ?? ""),
        targetChatId: typeof actionValue.chatId === "string" ? actionValue.chatId : undefined,
        ...base,
      };
    }
    if (action === "jump_snapshot") {
      return {
        kind: "snapshot_jump",
        turnId: String(actionValue.turnId ?? ""),
        threadId: typeof actionValue.threadId === "string" ? actionValue.threadId : undefined,
        ownerId: typeof actionValue.ownerId === "string" ? actionValue.ownerId : undefined,
        ...base,
      };
    }
    if (action === "admin_toggle") {
      return {
        kind: "admin_user_toggle",
        targetUserId: String(actionValue.userId ?? ""),
        promote: actionValue.promote === true,
        ...base,
      };
    }
    if (action === "admin_panel_home") return { kind: "admin_panel", panel: "home", ...base };
    if (action === "admin_panel_project") return { kind: "admin_panel", panel: "project", ...base };
    if (action === "admin_panel_member") return { kind: "admin_panel", panel: "member", ...base };
    if (action === "admin_panel_user") return { kind: "admin_panel", panel: "user", ...base };
    if (action === "admin_panel_skill") return { kind: "admin_panel", panel: "skill", ...base };
    if (action === "admin_panel_backend") return { kind: "admin_panel", panel: "backend", ...base };
    if (action === "admin_user_page") {
      return {
        kind: "admin_user_page",
        page: typeof actionValue.page === "number" ? actionValue.page : Number(actionValue.page ?? 0),
        ...base,
      };
    }
    if (action === "help_thread_new") {
      return { kind: "help_thread_new", messageId: String(payload.context?.open_message_id ?? ""), ...base };
    }
    if (action === "help_home" || action === "help_threads" || action === "help_history" || action === "help_skills" || action === "help_backends" || action === "help_turns" || action === "help_merge" || action === "help_project") {
      return { kind: "help_panel", panel: action, messageId: String(payload.context?.open_message_id ?? ""), ...base };
    }
    if (action === "help_project_save") {
      return { kind: "help_project_save", projectId: String(actionValue.projectId ?? ""), messageId: String(payload.context?.open_message_id ?? ""), ...base };
    }
    if (action === "help_project_push") {
      return { kind: "help_project_push", projectId: String(actionValue.projectId ?? ""), messageId: String(payload.context?.open_message_id ?? ""), ...base };
    }
    if (action === "help_skill_install") return { kind: "help_skill_install", skillName: String(actionValue.skillName ?? ""), ...base };
    if (action === "help_skill_remove") return { kind: "help_skill_remove", name: String(actionValue.name ?? ""), ...base };
    if (action === "merge_accept" || action === "merge_keep_main" || action === "merge_use_branch" || action === "merge_skip") {
      const decisionMap = {
        merge_accept: "accept",
        merge_keep_main: "keep_main",
        merge_use_branch: "use_branch",
        merge_skip: "skip",
      } as const;
      return {
        kind: "merge_file_decision",
        branchName: String(actionValue.branchName ?? ""),
        filePath: String(actionValue.filePath ?? ""),
        decision: decisionMap[action],
        ...base,
      };
    }

    // ── Project init / bind ────────────────────────────────────────────────
    if (action === "init_project") return { kind: "init_project", ...base };
    if (action === "init_root_menu") return { kind: "init_root_menu", ...base };
    if (action === "init_bind_menu") return { kind: "init_bind_menu", ...base };
    if (action === "init_create_menu") return { kind: "init_create_menu", ...base };
    if (action === "bind_existing_project") return { kind: "init_bind_existing", projectId: String(actionValue.projectId ?? ""), ...base };
    if (action === "install_skill") return { kind: "install_skill", ...base };

    // ── Admin project ──────────────────────────────────────────────────────
    if (action === "admin_project_edit") return { kind: "admin_project_edit", projectId: String(actionValue.projectId ?? ""), ...base };
    if (action === "admin_project_save") return { kind: "admin_project_save", projectId: String(actionValue.projectId ?? ""), ...base };
    if (action === "admin_project_toggle") return { kind: "admin_project_toggle", projectId: String(actionValue.projectId ?? ""), ...base };
    if (action === "admin_project_unbind") return { kind: "admin_project_unbind", projectId: String(actionValue.projectId ?? ""), ...base };
    if (action === "admin_project_delete") return { kind: "admin_project_delete", projectId: String(actionValue.projectId ?? ""), ...base };
    if (action === "admin_project_members") return { kind: "admin_project_members", projectId: String(actionValue.projectId ?? ""), ...base };
    if (action === "admin_search_project") return { kind: "admin_search_project", ...base };
    if (action === "admin_search_member") return { kind: "admin_search_member", ...base };
    if (action === "admin_search_user") return { kind: "admin_search_user", ...base };

    // ── Admin member / role ────────────────────────────────────────────────
    if (action === "admin_member_role_change") return { kind: "admin_member_role_change", projectId: String(actionValue.projectId ?? ""), targetUserId: String(actionValue.userId ?? ""), ...base };
    if (action === "help_role_change") return { kind: "help_role_change", projectId: String(actionValue.projectId ?? ""), targetUserId: String(actionValue.userId ?? ""), ...base };

    // ── Admin skill ────────────────────────────────────────────────────────
    if (action === "admin_skill_install_open") return { kind: "admin_skill_install_open", ...base };
    if (action === "admin_skill_file_install_open") return { kind: "admin_skill_file_install_open", ...base };
    if (action === "admin_skill_install_submit") return { kind: "admin_skill_install_submit", ...base };
    if (action === "admin_skill_file_install_submit") return { kind: "admin_skill_file_install_submit", ...base };
    if (action === "admin_skill_file_install_confirm") return { kind: "admin_skill_file_install_confirm", ...base };
    if (action === "admin_skill_file_install_cancel") return { kind: "admin_skill_file_install_cancel", ...base };
    if (action === "admin_skill_bind") return { kind: "admin_skill_bind", pluginName: String(actionValue.pluginName ?? ""), ...base };
    if (action === "admin_skill_unbind") return { kind: "admin_skill_unbind", pluginName: String(actionValue.pluginName ?? ""), ...base };

    // ── Admin backend ──────────────────────────────────────────────────────
    if (action === "admin_backend_edit") return { kind: "admin_backend_edit", backend: String(actionValue.backend ?? ""), ...base };
    if (action === "admin_backend_policy_edit") return { kind: "admin_backend_policy_edit", backend: String(actionValue.backend ?? ""), ...base };
    if (action === "admin_backend_policy_save") return { kind: "admin_backend_policy_save", backend: String(actionValue.backend ?? ""), ...base };
    if (action === "admin_backend_add_provider_form") return { kind: "admin_backend_add_provider_form", backend: String(actionValue.backend ?? ""), ...base };
    if (action === "admin_backend_add_provider") return { kind: "admin_backend_add_provider", backend: String(actionValue.backend ?? ""), ...base };
    if (action === "admin_backend_remove_provider") return { kind: "admin_backend_remove_provider", backend: String(actionValue.backend ?? ""), provider: String(actionValue.provider ?? ""), ...base };
    if (action === "admin_backend_model_manage") return { kind: "admin_backend_model_manage", backend: String(actionValue.backend ?? ""), ...base };
    if (action === "admin_backend_validate_model") return { kind: "admin_backend_validate_model", backend: String(actionValue.backend ?? ""), provider: String(actionValue.provider ?? ""), ...base };
    if (action === "admin_backend_remove_model") return { kind: "admin_backend_remove_model", backend: String(actionValue.backend ?? ""), provider: String(actionValue.provider ?? ""), model: String(actionValue.model ?? ""), ...base };
    if (action === "admin_backend_recheck") return { kind: "admin_backend_recheck", backend: String(actionValue.backend ?? ""), provider: String(actionValue.provider ?? ""), ...base };
    if (action === "admin_backend_add_profile") return { kind: "admin_backend_add_profile", backend: String(actionValue.backend ?? ""), ...base };
    if (action === "admin_backend_remove_profile") return { kind: "admin_backend_remove_profile", backend: String(actionValue.backend ?? ""), profileName: String(actionValue.profile ?? ""), ...base };

    return { kind: "raw", actionId: action, ...base };
  }
}
