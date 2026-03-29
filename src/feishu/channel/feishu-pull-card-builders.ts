/**
 * Feishu card builders for Project Pull preview and confirm results.
 * L1 platform-specific rendering of L2 ProjectPullPreviewResult / ProjectPullConfirmResult.
 */
import type { AppLocale } from "../../common/app-locale";
import type {
  ProjectPullPreviewResult,
  ProjectPullConfirmResult,
  ThreadDispositionEntry,
} from "../../../services";

const DEFAULT_LOCALE: AppLocale = "zh-CN";

// ── Disposition label / icon helpers ──

const DISPOSITION_LABEL: Record<string, { zh: string; en: string; color: string }> = {
  blocked_active_turn:        { zh: "🔴 有活跃 Turn", en: "🔴 Active turn", color: "red" },
  blocked_merge_session:      { zh: "🔴 Merge 进行中", en: "🔴 Merge in progress", color: "red" },
  blocked_merge_head_present: { zh: "🔴 存在 MERGE_HEAD", en: "🔴 MERGE_HEAD present", color: "red" },
  blocked_unknown_state:      { zh: "🔴 未知状态", en: "🔴 Unknown state", color: "red" },
  auto_fast_forward:          { zh: "🟢 自动 fast-forward", en: "🟢 Auto fast-forward", color: "green" },
  auto_recreate:              { zh: "🟡 自动重建", en: "🟡 Auto recreate", color: "orange" },
  manual_stale_diverged:      { zh: "🟡 手动：已分叉", en: "🟡 Manual: diverged", color: "orange" },
  manual_dirty_worktree:      { zh: "🟡 手动：脏 worktree", en: "🟡 Manual: dirty worktree", color: "orange" },
  manual_missing_worktree:    { zh: "🟡 手动：worktree 缺失", en: "🟡 Manual: missing worktree", color: "orange" },
  noop_already_aligned:       { zh: "⚪ 已对齐", en: "⚪ Already aligned", color: "grey" },
};

function dispositionLabel(d: string, locale: AppLocale): string {
  const entry = DISPOSITION_LABEL[d];
  if (!entry) return d;
  return locale === "en-US" ? entry.en : entry.zh;
}

// ── Strings ──

function getStrings(locale: AppLocale) {
  if (locale === "en-US") {
    return {
      previewTitle: "Pull Preview",
      previewSubtitle: (name: string) => `${name} · branch alignment check`,
      modeLabel: "Mode",
      currentHead: "Current HEAD",
      targetHead: "Target HEAD",
      expiresAt: "Expires at",
      hardBlockersTitle: "**⛔ Hard Blockers** — Resolve before confirming",
      autoUpdatesTitle: "**✅ Auto Updates** — Will be processed automatically",
      manualFollowTitle: "**⚠️ Manual Follow-Ups** — Require manual attention after pull",
      threadCol: "Thread",
      statusCol: "Status",
      reasonCol: "Reason",
      noOp: "Already up to date",
      confirmBtn: "Confirm Pull",
      cancelBtn: "Cancel",
      blockedHint: "Cannot confirm: resolve hard blockers first.",
      confirmTitle: "Pull Completed",
      confirmSubtitle: (name: string) => `${name} · branch updated`,
      oldHead: "Old HEAD",
      newHead: "New HEAD",
      autoUpdatedTitle: "**✅ Auto-Updated Threads**",
      manualTitle: "**⚠️ Manual Follow-Ups**",
      errorsTitle: "**❌ Non-Fatal Errors**",
      backBtn: "Back to Project",
    };
  }
  return {
    previewTitle: "Pull 预览",
    previewSubtitle: (name: string) => `${name} · 分支对齐检查`,
    modeLabel: "模式",
    currentHead: "当前 HEAD",
    targetHead: "目标 HEAD",
    expiresAt: "过期时间",
    hardBlockersTitle: "**⛔ 硬阻塞** — 确认前需解决",
    autoUpdatesTitle: "**✅ 自动更新** — 将自动处理",
    manualFollowTitle: "**⚠️ 手动跟进** — Pull 后需手动处理",
    threadCol: "Thread",
    statusCol: "状态",
    reasonCol: "原因",
    noOp: "已是最新",
    confirmBtn: "确认 Pull",
    cancelBtn: "取消",
    blockedHint: "无法确认：请先处理硬阻塞。",
    confirmTitle: "Pull 完成",
    confirmSubtitle: (name: string) => `${name} · 分支已更新`,
    oldHead: "旧 HEAD",
    newHead: "新 HEAD",
    autoUpdatedTitle: "**✅ 已自动更新的线程**",
    manualTitle: "**⚠️ 手动跟进**",
    errorsTitle: "**❌ 非致命错误**",
    backBtn: "返回项目管理",
  };
}

// ── Thread disposition table ──

function buildDispositionTable(
  entries: ThreadDispositionEntry[],
  locale: AppLocale,
): unknown {
  if (entries.length === 0) return null;
  const rows = entries.map(e =>
    `\`${e.threadName}\` — ${dispositionLabel(e.disposition, locale)}${e.reason ? ` (${e.reason})` : ""}`
  ).join("\n");
  return { tag: "markdown", content: rows };
}

// ── Preview card ──

export function buildProjectPullPreviewCard(
  result: ProjectPullPreviewResult,
  ownerId: string,
  locale: AppLocale = DEFAULT_LOCALE,
): Record<string, unknown> {
  const s = getStrings(locale);

  // no_op early return
  if (result.mode === "no_op") {
    return {
      schema: "2.0",
      config: { width_mode: "fill", update_multi: true },
      header: {
        title: { tag: "plain_text", content: s.previewTitle },
        subtitle: { tag: "plain_text", content: s.noOp },
        template: "green",
        icon: { tag: "standard_icon", token: "check_outlined", color: "green" },
      },
      body: {
        direction: "vertical",
        vertical_spacing: "8px",
        padding: "8px 12px 12px 12px",
        elements: [
          { tag: "markdown", content: `✅ ${s.noOp}`, icon: { tag: "standard_icon", token: "check_outlined", color: "green" } },
          {
            tag: "button", text: { tag: "plain_text", content: s.backBtn },
            type: "default", size: "medium", width: "fill",
            icon: { tag: "standard_icon", token: "arrow-left_outlined" },
            behaviors: [{ type: "callback", value: { action: "help_project", ownerId } }],
          },
        ],
      },
    };
  }

  const elements: unknown[] = [];

  // Info rows
  const modeDisplay = result.mode === "fast_forward" ? "Fast-Forward" : "Rewrite (defensive)";
  elements.push({ tag: "markdown", content: `**${s.modeLabel}**: ${modeDisplay}` });
  elements.push({ tag: "markdown", content: `**${s.currentHead}**: \`${result.currentHead.slice(0, 8)}\`  →  **${s.targetHead}**: \`${result.targetHead.slice(0, 8)}\`` });

  // Hard blockers
  if (result.hardBlockers.length > 0) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: s.hardBlockersTitle });
    const table = buildDispositionTable(result.hardBlockers, locale);
    if (table) elements.push(table);
  }

  // Auto updates
  if (result.autoUpdates.length > 0) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: s.autoUpdatesTitle });
    const table = buildDispositionTable(result.autoUpdates, locale);
    if (table) elements.push(table);
  }

  // Manual follow-ups
  if (result.manualFollowUps.length > 0) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: s.manualFollowTitle });
    const table = buildDispositionTable(result.manualFollowUps, locale);
    if (table) elements.push(table);
  }

  // Action buttons
  elements.push({ tag: "hr" });

  if (result.canConfirm) {
    elements.push({
      tag: "column_set", flex_mode: "bisect", horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [{
            tag: "button",
            text: { tag: "plain_text", content: s.confirmBtn },
            type: "primary", size: "medium", width: "fill",
            icon: { tag: "standard_icon", token: "check_outlined" },
            behaviors: [{ type: "callback", value: { action: "project_pull_confirm", projectId: result.projectId, previewId: result.previewId, ownerId } }],
          }],
        },
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [{
            tag: "button",
            text: { tag: "plain_text", content: s.cancelBtn },
            type: "default", size: "medium", width: "fill",
            icon: { tag: "standard_icon", token: "close_outlined" },
            behaviors: [{ type: "callback", value: { action: "help_project", ownerId } }],
          }],
        },
      ],
    });
  } else {
    elements.push({
      tag: "markdown",
      content: `⚠️ ${s.blockedHint}`,
      icon: { tag: "standard_icon", token: "warning_outlined", color: "orange" },
    });
    elements.push({
      tag: "button",
      text: { tag: "plain_text", content: s.backBtn },
      type: "default", size: "medium", width: "fill",
      icon: { tag: "standard_icon", token: "arrow-left_outlined" },
      behaviors: [{ type: "callback", value: { action: "help_project", ownerId } }],
    });
  }

  const headerTemplate = result.canConfirm ? "blue" : "orange";
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.previewTitle },
      subtitle: { tag: "plain_text", content: s.previewSubtitle(result.projectName) },
      template: headerTemplate,
      icon: { tag: "standard_icon", token: "download_outlined", color: headerTemplate },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: modeDisplay }, color: result.mode === "fast_forward" ? "green" : "orange" },
      ],
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "8px 12px 12px 12px",
      elements,
    },
  };
}

// ── Confirm result card ──

export function buildProjectPullConfirmCard(
  result: ProjectPullConfirmResult,
  ownerId: string,
  locale: AppLocale = DEFAULT_LOCALE,
): Record<string, unknown> {
  const s = getStrings(locale);

  const elements: unknown[] = [];
  const modeDisplay = result.mode === "fast_forward" ? "Fast-Forward" : "Rewrite (defensive)";

  elements.push({ tag: "markdown", content: `**${s.modeLabel}**: ${modeDisplay}` });
  elements.push({ tag: "markdown", content: `**${s.oldHead}**: \`${result.oldHead.slice(0, 8)}\`  →  **${s.newHead}**: \`${result.newHead.slice(0, 8)}\`` });

  // Auto-updated threads
  if (result.autoUpdatedThreads.length > 0) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: s.autoUpdatedTitle });
    const lines = result.autoUpdatedThreads.map((t: { threadName: string; disposition: string; newBaseSha: string }) =>
      `\`${t.threadName}\` — ${dispositionLabel(t.disposition, locale)} → \`${t.newBaseSha.slice(0, 8)}\``
    ).join("\n");
    elements.push({ tag: "markdown", content: lines });
  }

  // Manual follow-ups
  if (result.manualFollowUps.length > 0) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: s.manualTitle });
    const table = buildDispositionTable(result.manualFollowUps, locale);
    if (table) elements.push(table);
  }

  // Non-fatal errors
  if (result.errors.length > 0) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: s.errorsTitle });
    const lines = result.errors.map((e: { threadName: string; error: string }) => `\`${e.threadName}\` — ${e.error}`).join("\n");
    elements.push({ tag: "markdown", content: lines });
  }

  // Back button
  elements.push({ tag: "hr" });
  elements.push({
    tag: "button",
    text: { tag: "plain_text", content: s.backBtn },
    type: "default", size: "medium", width: "fill",
    icon: { tag: "standard_icon", token: "arrow-left_outlined" },
    behaviors: [{ type: "callback", value: { action: "help_project", ownerId } }],
  });

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.confirmTitle },
      subtitle: { tag: "plain_text", content: s.confirmSubtitle(result.projectId.slice(0, 8)) },
      template: result.errors.length > 0 ? "orange" : "green",
      icon: { tag: "standard_icon", token: "check_outlined", color: result.errors.length > 0 ? "orange" : "green" },
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "8px 12px 12px 12px",
      elements,
    },
  };
}
