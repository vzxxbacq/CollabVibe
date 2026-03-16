/**
 * @module packages/channel-feishu/src/feishu-card-builders
 *
 * Stateless card JSON builder functions for Feishu interactive cards (schema v2).
 * All functions are pure — they take data in and return card JSON out.
 *
 * Covers: help, thread, merge, init, model, snapshot, skill, and admin panel cards.
 *
 * Extracted from FeishuOutputAdapter for better cohesion.
 */
import { MAIN_THREAD_NAME } from "../../agent-core/src/constants";
import { DEFAULT_APP_LOCALE, type AppLocale } from "../../channel-core/src/app-locale";
import type { MergeDiffStats } from "../../git-utils/src/merge";
import { getFeishuCardBuilderStrings } from "./feishu-card-builders.strings";
import type {
  IMAdminBackendPanel,
  IMAdminMemberPanel,
  IMAdminProjectPanel,
  IMAdminSkillPanel,
  IMAdminUserPanel,
  IMFileMergeReview,
  IMMergeSummary,
} from "../../channel-core/src/index";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * 飞书 element_id 规范: 仅允许 [a-zA-Z0-9_]，必须字母开头，最长 20 字符。
 * 此函数仅做字符清洗；调用方应确保传入的 raw 值自身足够短（≤20）。
 */
function sanitizeElementId(raw: string): string {
  let id = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!/^[a-zA-Z]/.test(id)) id = "e" + id;
  return id;
}

/** div + plain_text with grey notation — text_color is only valid on plain_text, NOT markdown */
function greyText(content: string): Record<string, unknown> {
  return {
    tag: "div",
    text: { tag: "plain_text", content, text_size: "notation", text_color: "grey" }
  };
}

function formatUserLabel(userId: string, displayName?: string): string {
  const normalized = String(displayName ?? "").trim();
  if (normalized && /\([A-Za-z0-9_-]{6}\)$/.test(normalized)) {
    return normalized;
  }
  const suffix = userId ? userId.slice(-6) : "unknown";
  const name = normalized || "unknown";
  return `${name}(${suffix})`;
}

function pluginSourceLabel(sourceType: string, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  const s = getFeishuCardBuilderStrings(locale);
  switch (sourceType) {
    case "github-subpath": return s.pluginSourceGithubSubpath;
    case "feishu-upload": return s.pluginSourceFeishuUpload;
    default: return sourceType.toUpperCase();
  }
}

function backPanel(label: string, action: string, actionValue?: Record<string, unknown>): Record<string, unknown> {
  return {
    tag: "interactive_container",
    width: "fill", height: "auto",
    has_border: true, border_color: "grey", corner_radius: "8px",
    padding: "10px 12px 10px 12px",
    behaviors: [{ type: "callback", value: { action, ...actionValue } }],
    elements: [{
      tag: "markdown", content: `**${label}**`,
      icon: { tag: "standard_icon", token: "arrow-left_outlined", color: "grey" }
    }]
  };
}

/** 统一导航入口 — 用于概览页后端行和编辑页子卡片入口 */
function navEntry(opts: {
  icon: string; title: string; subtitle?: string;
  action: string; actionValue?: Record<string, unknown>;
}): Record<string, unknown> {
  const columns: unknown[] = [
    {
      tag: "column", width: "weighted", weight: 1, vertical_align: "center",
      elements: [{
        tag: "markdown", content: `**${opts.title}**`,
        icon: { tag: "standard_icon", token: opts.icon, color: "turquoise" }
      }]
    }
  ];
  if (opts.subtitle) {
    columns.push({
      tag: "column", width: "auto", vertical_align: "center",
      elements: [greyText(opts.subtitle)]
    });
  }
  return {
    tag: "interactive_container",
    width: "fill", height: "auto",
    has_border: true, border_color: "grey", corner_radius: "8px",
    padding: "10px 12px 10px 12px",
    margin: "2px 0",
    behaviors: [{ type: "callback", value: { action: opts.action, ...opts.actionValue } }],
    elements: [{
      tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
      columns
    }]
  };
}

/** 搜索表单 — form + input + submit button */
function searchForm(
  action: string,
  placeholder: string,
  defaultValue?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): Record<string, unknown> {
  const fId = sanitizeElementId(`sf_${action}`);
  return {
    tag: "form", name: fId, element_id: fId,
    elements: [{
      tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 4, vertical_align: "center",
          elements: [{
            tag: "input", name: "search_keyword",
            placeholder: { tag: "plain_text", content: placeholder },
            default_value: defaultValue ?? ""
          }]
        },
        {
          tag: "column", width: "auto", vertical_align: "center",
          elements: [{
            tag: "button", text: { tag: "plain_text", content: getFeishuCardBuilderStrings(locale).searchButton },
            name: "search_submit",
            type: "primary", size: "small",
            icon: { tag: "standard_icon", token: "search_outlined" },
            form_action_type: "submit",
            behaviors: [{ type: "callback", value: { action } }]
          }]
        }
      ]
    }]
  };
}

/** Display API key field smartly:
 *  - Env var name (ALL_CAPS_UNDERSCORES) → "$CODEX_API_KEY"
 *  - Literal key (has lowercase/special) → "sk-****last4"
 */
function displayKey(value?: string): string {
  if (!value) return "-";
  if (/^[A-Z][A-Z0-9_]*$/.test(value)) return `$${value}`;
  if (value.length <= 8) return value.slice(0, 2) + "****";
  return value.slice(0, 3) + "****" + value.slice(-4);
}

// ── Card Builders ────────────────────────────────────────────────────────────

/**
 * Build a thread list card JSON.
 */
export function buildThreadListCard(
  threads: Array<{ threadName: string; threadId: string; active?: boolean }>,
  userId?: string,
  displayName?: string,
  isOnMain?: boolean,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];

  // main 条目 — 始终显示在顶部，用 interactive_container 高亮
  const mainRightCol = isOnMain
    ? {
      tag: "column", width: "auto", vertical_align: "center",
      elements: [{ tag: "markdown", content: s.threadCurrentReadonly, text_align: "right" }]
    }
    : {
      tag: "column", width: "auto", vertical_align: "center",
      elements: [{
        tag: "button", text: { tag: "plain_text", content: s.threadSwitch },
        type: "default", size: "small", width: "default",
        icon: { tag: "standard_icon", token: "switch_outlined" },
        behaviors: [{ type: "callback", value: { action: "switch_to_main", ownerId: userId ?? "" } }]
      }]
    };
  elements.push({
    tag: "interactive_container",
    width: "fill",
    height: "auto",
    background_style: "grey",
    corner_radius: "8px",
    padding: "8px 12px 8px 12px",
    has_border: false,
    disabled: true,
    elements: [{
      tag: "column_set", flex_mode: "bisect", background_style: "default", horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [{
            tag: "markdown",
            content: s.threadMainDescription,
            icon: { tag: "standard_icon", token: "lock_outlined", color: "grey" }
          }]
        },
        mainRightCol
      ]
    }]
  });

  // 其他 thread 条目
  for (const t of threads) {
    const rightCol = t.active
      ? {
        tag: "column", width: "auto", vertical_align: "center",
        elements: [{ tag: "markdown", content: s.threadCurrent, text_align: "right" }]
      }
      : {
        tag: "column", width: "auto", vertical_align: "center",
        elements: [{
          tag: "button", text: { tag: "plain_text", content: s.threadSwitch },
          type: "default", size: "small", width: "default",
          icon: { tag: "standard_icon", token: "switch_outlined" },
          behaviors: [{ type: "callback", value: { action: "switch_thread", threadName: t.threadName, ownerId: userId ?? "" } }]
        }]
      };
    elements.push({
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      has_border: true,
      border_color: t.active ? "blue" : "grey",
      corner_radius: "6px",
      padding: "8px 12px 8px 12px",
      margin: "4px 0",
      background_style: "default",
      disabled: true,
      elements: [{
        tag: "column_set", flex_mode: "bisect", background_style: "default", horizontal_spacing: "default",
        columns: [
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [{ tag: "markdown", content: `**${t.threadName}**\nID: \`${t.threadId.slice(0, 8)}\`` }]
          },
          rightCol
        ]
      }]
    });
  }

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.threadListTitle },
      subtitle: { tag: "plain_text", content: s.threadListSubtitle(displayName) },
      template: "blue",
      icon: { tag: "standard_icon", token: "list-setting_outlined", color: "blue" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: s.threadListCount(threads.length + 1) }, color: "blue" }
      ]
    },
    body: {
      direction: "vertical",
      vertical_spacing: "4px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

export function buildMergePreviewCard(
  chatId: string,
  branchName: string,
  baseBranch: string,
  diffStats: MergeDiffStats,
  canMerge: boolean,
  conflicts?: string[],
  resolverThread?: { threadName: string; threadId: string },
  ownerId?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): Record<string, unknown> {
  const txt = getFeishuCardBuilderStrings(locale);
  const elements: Record<string, unknown>[] = [];

  // ── File changes ──
  if (diffStats.filesChanged.length > 0) {
    elements.push({
      tag: "markdown",
      content: txt.mergePreviewChanged(diffStats.filesChanged.length, diffStats.additions, diffStats.deletions),
      icon: { tag: "standard_icon", token: "code_outlined", color: "turquoise" }
    });

    if (diffStats.fileDiffs && diffStats.fileDiffs.length > 0) {
      for (const fd of diffStats.fileDiffs) {
        elements.push({
          tag: "collapsible_panel",
          expanded: false,
          header: {
            title: { tag: "markdown", content: fd.file },
            icon: { tag: "standard_icon", token: "code_outlined", color: "grey", size: "16px 16px" },
            icon_position: "follow_text", icon_expanded_angle: -180
          },
          vertical_spacing: "2px",
          background_color: "grey",
          elements: [{ tag: "markdown", content: "```diff\n" + fd.diff + "\n```" }]
        });
      }
    } else {
      const fileList = diffStats.filesChanged.map((f) => `• ${f}`).join("\n");
      elements.push({ tag: "markdown", content: fileList });
    }
  } else {
    elements.push(greyText(txt.mergePreviewNoChanges));
  }

  // ── Conflicts ──
  if (conflicts && conflicts.length > 0) {
    elements.push({ tag: "hr" });
    const conflictInner: Record<string, unknown>[] = conflicts.map((f) => ({
      tag: "column_set",
      flex_mode: "none",
      background_style: "default",
      horizontal_spacing: "small",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 4,
          vertical_align: "center",
          elements: [{ tag: "markdown", content: `\`${f}\`` }]
        },
        {
          tag: "column",
          width: "auto",
          vertical_align: "center",
          elements: [
            {
              tag: "text_tag",
              text: { tag: "plain_text", content: txt.mergeConflictResolverTag },
              color: "blue"
            }
          ]
        }
      ]
    }));
    conflictInner.push({
      tag: "markdown",
      content: txt.mergeConflictResolverHelp(resolverThread?.threadName)
    });
    conflictInner.push({ tag: "markdown", content: txt.mergeForceHint });
    elements.push({
      tag: "collapsible_panel",
      expanded: true,
      header: {
        title: { tag: "markdown", content: txt.mergeConflictCount(conflicts.length) },
        icon: { tag: "standard_icon", token: "warning_outlined", color: "red", size: "16px 16px" },
        icon_position: "follow_text", icon_expanded_angle: -180
      },
      border: { color: "grey", corner_radius: "5px" },
      vertical_spacing: "4px",
      padding: "8px 8px 8px 8px",
      elements: conflictInner
    });
  }

  // ── Action buttons ──
  elements.push({ tag: "hr" });
  if (canMerge) {
    if (diffStats.filesChanged.length === 0) {
      elements.push(greyText(txt.mergeNoChangesCleanupHint));
    }
    elements.push({
      tag: "column_set",
      flex_mode: "bisect",
      background_style: "default",
      horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [{
            tag: "interactive_container",
            width: "fill", height: "auto",
            has_border: true, border_color: "grey", corner_radius: "8px",
            padding: "10px 12px 10px 12px",
            behaviors: [{ type: "callback", value: { action: "confirm_merge", chatId, branchName } }],
            elements: [{
              tag: "markdown", content: txt.mergeConfirm,
              icon: { tag: "standard_icon", token: "check_outlined", color: "green" }
            }]
          }]
        },
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [{
            tag: "interactive_container",
            width: "fill", height: "auto",
            has_border: true, border_color: "grey", corner_radius: "8px",
            padding: "10px 12px 10px 12px",
            behaviors: [{ type: "callback", value: { action: "help_merge", ownerId, branchName } }],
            elements: [{
              tag: "markdown", content: txt.mergeBack,
              icon: { tag: "standard_icon", token: "arrow-left_outlined", color: "grey" }
            }]
          }]
        }
      ]
    });
  } else {
    elements.push({
      tag: "markdown",
      content: txt.mergeConflictDetail(Boolean(resolverThread)),
      icon: { tag: "standard_icon", token: "warning_outlined", color: "orange" }
    });
    elements.push({
      tag: "column_set",
      flex_mode: "bisect",
      background_style: "default",
      horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [{
            tag: "interactive_container",
            width: "fill", height: "auto",
            has_border: true, border_color: "orange", corner_radius: "8px",
            padding: "10px 12px 10px 12px",
            behaviors: [{ type: "callback", value: { action: "merge_start_review", chatId, branchName } }],
            elements: [{
              tag: "markdown", content: txt.mergeStartReview(Boolean(resolverThread)),
              icon: { tag: "standard_icon", token: "edit_outlined", color: "orange" }
            }]
          }]
        },
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [{
            tag: "interactive_container",
            width: "fill", height: "auto",
            has_border: true, border_color: "grey", corner_radius: "8px",
            padding: "10px 12px 10px 12px",
            behaviors: [{ type: "callback", value: { action: "help_merge", ownerId, branchName } }],
            elements: [{
              tag: "markdown", content: txt.mergeBack,
              icon: { tag: "standard_icon", token: "arrow-left_outlined", color: "grey" }
            }]
          }]
        }
      ]
    });
  }

  // ── Header tags ──
  const headerTags: Record<string, unknown>[] = [
    { tag: "text_tag", text: { tag: "plain_text", content: canMerge ? txt.mergeCanMerge : txt.mergeHasConflict }, color: canMerge ? "green" : "red" }
  ];
  if (conflicts && conflicts.length > 0 && resolverThread) {
    headerTags.push({
      tag: "text_tag",
      text: { tag: "plain_text", content: txt.mergeConflictResolverTag },
      color: "blue"
    });
  }
  if (diffStats.filesChanged.length > 0) {
    headerTags.push({ tag: "text_tag", text: { tag: "plain_text", content: `${diffStats.filesChanged.length} files` }, color: "turquoise" });
    headerTags.push({ tag: "text_tag", text: { tag: "plain_text", content: `+${diffStats.additions} / -${diffStats.deletions}` }, color: "neutral" });
  }

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: `${branchName} → ${baseBranch}` },
      subtitle: { tag: "plain_text", content: txt.mergePreviewSubtitle },
      icon: { tag: "standard_icon", token: "switch_outlined", color: canMerge ? "green" : "red" },
      text_tag_list: headerTags,
      template: canMerge ? "green" : "red"
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

export function buildMergeResultCard(
  branchName: string,
  baseBranch: string,
  success: boolean,
  message: string,
  diffStats?: MergeDiffStats,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): Record<string, unknown> {
  const txt = getFeishuCardBuilderStrings(locale);
  const elements: Record<string, unknown>[] = [];

  if (success && diffStats && diffStats.filesChanged.length > 0) {
    const fileList = diffStats.filesChanged.map((f) => `• \`${f}\``).join("\n");
    elements.push({
      tag: "markdown",
      content: txt.mergeMergedFiles(diffStats.filesChanged.length, diffStats.additions, diffStats.deletions, fileList),
      icon: { tag: "standard_icon", token: "code_outlined", color: "green" }
    });
  }

  if (message) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: `\`\`\`\n${message.slice(0, 500)}\n\`\`\`` });
  }

  const resultTags: Record<string, unknown>[] = [
    { tag: "text_tag", text: { tag: "plain_text", content: success ? txt.mergeResultSuccess : txt.mergeResultFailed }, color: success ? "green" : "red" }
  ];

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: `${branchName} → ${baseBranch}` },
      subtitle: { tag: "plain_text", content: success ? txt.mergeResultSuccessSubtitle : txt.mergeResultFailedSubtitle },
      icon: { tag: "standard_icon", token: success ? "done_outlined" : "close_outlined", color: success ? "green" : "red" },
      text_tag_list: resultTags,
      template: success ? "green" : "red"
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

export function buildSnapshotHistoryCard(
  snapshots: Array<{ turnId: string; turnIndex: number; agentSummary?: string; filesChanged?: string[]; createdAt: string; isCurrent: boolean }>,
  threadId: string,
  _userId?: string,
  displayName?: string,
  threadName?: string,
  fromHelp?: boolean,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): Record<string, unknown> {
  const txt = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];

  for (const s of snapshots) {
    const time = s.createdAt.slice(11, 16);
    const rawSummary = s.agentSummary ?? txt.snapshotNoSummary;
    const summary = rawSummary.length > 30 ? rawSummary.slice(0, 30) + "…" : rawSummary;
    const fileCount = s.filesChanged?.length ?? 0;

    const rightCol = s.isCurrent
      ? {
        tag: "column", width: "auto", vertical_align: "center",
        elements: [{ tag: "markdown", content: txt.threadCurrent, text_align: "right" }]
      }
      : {
        tag: "column", width: "auto", vertical_align: "center",
        elements: [{
          tag: "button", text: { tag: "plain_text", content: txt.snapshotJump },
          type: "primary", size: "small", width: "default",
          icon: { tag: "standard_icon", token: "history_outlined" },
          behaviors: [{ type: "callback", value: { action: "jump_snapshot", turnId: s.turnId, threadId, ownerId: _userId ?? "" } }]
        }]
      };

    const leftElements: unknown[] = [
      { tag: "markdown", content: `**#${s.turnIndex}**  ·  ${time}` },
      { tag: "markdown", content: summary, text_size: "notation" }
    ];
    if (fileCount > 0) {
      leftElements.push(greyText(txt.snapshotFiles(fileCount)));
    }

    elements.push({
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      has_border: true,
      border_color: s.isCurrent ? "blue" : "grey",
      corner_radius: "6px",
      padding: "8px 12px 8px 12px",
      margin: "4px 0",
      background_style: "default",
      disabled: true,
      elements: [{
        tag: "column_set", flex_mode: "bisect", background_style: "default", horizontal_spacing: "default",
        columns: [
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            vertical_spacing: "4px",
            elements: leftElements
          },
          rightCol
        ]
      }]
    });
  }

  if (fromHelp) {
    elements.push({ tag: "hr" });
    elements.push(backPanel(txt.snapshotBackToHelp, "help_home"));
  }

  const titleText = threadId === MAIN_THREAD_NAME
    ? txt.snapshotMainTitle
    : txt.snapshotThreadTitle(threadName ?? threadId);

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: titleText },
      subtitle: {
        tag: "plain_text",
        content: threadId === MAIN_THREAD_NAME ? txt.snapshotMainSubtitle : txt.snapshotThreadSubtitle
      },
      template: "blue",
      icon: { tag: "standard_icon", token: "time_outlined", color: "blue" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: txt.snapshotVersionCount(snapshots.length) }, color: "blue" }
      ]
    },
    body: {
      direction: "vertical",
      vertical_spacing: "4px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

export function buildThreadCreatedCard(info: {
  threadName: string; threadId: string;
  backendName?: string; modelName?: string;
}, locale: AppLocale = DEFAULT_APP_LOCALE): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.threadCreatedTitle },
      subtitle: { tag: "plain_text", content: info.threadName },
      template: "green"
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "8px 12px 12px 12px",
      elements: [
        {
          tag: "markdown",
          content: [
            `${s.threadCreatedName}: ${info.threadName}`,
            `${s.threadCreatedId}: \`${info.threadId.slice(0, 8)}\``,
            info.backendName ? `${s.threadCreatedBackend}: ${info.backendName}` : null,
            info.modelName ? `${s.threadCreatedModel}: ${info.modelName}` : null
          ].filter(Boolean).join("\n")
        },
        { tag: "hr" },
        { tag: "markdown", content: s.threadCreatedHint }
      ]
    }
  };
}

export function buildInitCard(
  unboundProjects?: Array<{ id: string; name: string; cwd: string; gitUrl?: string }>,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const safeUnboundProjects = unboundProjects ?? [];

  const actions: unknown[] = [];
  if (safeUnboundProjects.length > 0) {
    actions.push({
      tag: "interactive_container",
      width: "fill", height: "auto",
      has_border: true, border_color: "blue", corner_radius: "8px",
      padding: "12px 14px 12px 14px",
      behaviors: [{ type: "callback", value: { action: "init_bind_menu" } }],
      elements: [{
        tag: "markdown",
        content: s.initBindExisting(safeUnboundProjects.length),
        icon: { tag: "standard_icon", token: "sharelink_outlined", color: "blue" }
      }]
    });
  }

  actions.push({
    tag: "interactive_container",
    width: "fill", height: "auto",
    has_border: true, border_color: "green", corner_radius: "8px",
    padding: "12px 14px 12px 14px",
    behaviors: [{ type: "callback", value: { action: "init_create_menu" } }],
    elements: [{
      tag: "markdown",
      content: s.initCreateNew,
      icon: { tag: "standard_icon", token: "add_outlined", color: "green" }
    }]
  });

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.initTitle },
      subtitle: { tag: "plain_text", content: s.initSubtitle },
      template: "blue",
      icon: { tag: "standard_icon", token: "app_outlined", color: "blue" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: s.initTagInit }, color: "blue" },
        { tag: "text_tag", text: { tag: "plain_text", content: s.initTagPending }, color: "neutral" }
      ]
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "8px 12px 12px 12px",
      elements: [
        greyText(s.initIntro),
        ...actions
      ]
    }
  };
}

export function buildInitBindMenuCard(
  unboundProjects?: Array<{ id: string; name: string; cwd: string; gitUrl?: string }>,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const safeUnboundProjects = unboundProjects ?? [];
  const bindElements: unknown[] = [
    backPanel(s.initBack, "init_root_menu"),
    greyText(s.initBindHint)
  ];

  if (safeUnboundProjects.length === 0) {
    bindElements.push(greyText(s.initNoUnbound));
  } else {
    for (const p of safeUnboundProjects) {
      bindElements.push({
        tag: "interactive_container",
        width: "fill", height: "auto",
        has_border: true, border_color: "grey", corner_radius: "8px",
        padding: "10px 12px 10px 12px", margin: "2px 0",
        elements: [{
          tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
          columns: [
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [
                { tag: "markdown", content: `**${p.name}**`, icon: { tag: "standard_icon", token: "folder_outlined", color: "blue" } },
                greyText(`${p.cwd}${p.gitUrl ? `  ·  ${p.gitUrl}` : ""}`)
              ]
            },
            {
              tag: "column", width: "auto", vertical_align: "center",
              elements: [{
                tag: "button",
                text: { tag: "plain_text", content: s.initBindToCurrentChat },
                type: "primary", size: "small",
                icon: { tag: "standard_icon", token: "sharelink_outlined" },
                behaviors: [{ type: "callback", value: { action: "bind_existing_project", projectId: p.id } }]
              }]
            }
          ]
        }]
      });
    }
  }

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.initBindTitle },
      subtitle: { tag: "plain_text", content: s.initBindSubtitle },
      template: "blue",
      icon: { tag: "standard_icon", token: "sharelink_outlined", color: "blue" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: s.initTagInit }, color: "blue" },
        { tag: "text_tag", text: { tag: "plain_text", content: s.initBindTag }, color: "neutral" }
      ]
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "8px 12px 12px 12px",
      elements: bindElements
    }
  };
}

export function buildInitCreateMenuCard(locale: AppLocale = DEFAULT_APP_LOCALE): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const fields = [
    { icon: "edit_outlined", label: s.initCreateFields[0]!.label, name: "project_name", placeholder: s.initCreateFields[0]!.placeholder, defaultValue: "" },
    { icon: "folder_outlined", label: s.initCreateFields[1]!.label, name: "project_cwd", placeholder: s.initCreateFields[1]!.placeholder, defaultValue: "", hint: s.initCreateFields[1]!.hint },
    { icon: "sharelink_outlined", label: s.initCreateFields[2]!.label, name: "git_url", placeholder: s.initCreateFields[2]!.placeholder, defaultValue: "", hint: s.initCreateFields[2]!.hint },
    { icon: "lock_outlined", label: s.initCreateFields[3]!.label, name: "git_token", placeholder: s.initCreateFields[3]!.placeholder, defaultValue: "", hint: s.initCreateFields[3]!.hint }
  ];

  const formElements: unknown[] = [];
  for (const f of fields) {
    formElements.push({
      tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "fill", vertical_align: "center",
          elements: [
            {
              tag: "markdown",
              content: `**${f.label}**`,
              icon: { tag: "standard_icon", token: f.icon, color: "green" }
            }
          ]
        }
      ]
    });
    formElements.push({
      tag: "input", name: f.name,
      placeholder: { tag: "plain_text", content: f.placeholder },
      default_value: f.defaultValue
    });
    if (f.hint) {
      formElements.push(greyText(f.hint));
    }
  }

  formElements.push({
    tag: "button",
    text: { tag: "plain_text", content: s.initCreateSubmit },
    type: "primary", width: "fill",
    icon: { tag: "standard_icon", token: "add_outlined" },
    form_action_type: "submit",
    name: "init_project_submit",
    behaviors: [{ type: "callback", value: { action: "init_project" } }]
  });

  const createForm = {
    tag: "form",
    name: "init_project_form",
    element_id: "init_project_form",
    elements: [
      backPanel(s.initBack, "init_root_menu"),
      ...formElements
    ]
  };

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.initCreateTitle },
      subtitle: { tag: "plain_text", content: s.initCreateSubtitle },
      template: "blue",
      icon: { tag: "standard_icon", token: "add_outlined", color: "blue" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: s.initTagInit }, color: "blue" },
        { tag: "text_tag", text: { tag: "plain_text", content: s.initCreateTag }, color: "neutral" }
      ]
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "8px 12px 12px 12px",
      elements: [createForm]
    }
  };
}

/**
 * Card shown when bot re-joins a chat that already has a bound project.
 * Shows project info and confirms restoration.
 */
export function buildProjectResumedCard(
  project: { name: string; id: string; cwd: string; gitUrl?: string; status?: string },
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const infoRows = [
    { icon: "edit_outlined", label: s.projectResumedProject, value: project.name },
    { icon: "hash_outlined", label: s.projectResumedId, value: `\`${project.id}\`` },
    { icon: "folder_outlined", label: s.projectResumedDir, value: `\`${project.cwd}\`` },
    { icon: "sharelink_outlined", label: s.projectResumedRepo, value: project.gitUrl || s.projectResumedLocalGit }
  ];

  const elements: unknown[] = [];
  for (const r of infoRows) {
    elements.push({
      tag: "markdown",
      content: `**${r.label}**  ${r.value}`,
      icon: { tag: "standard_icon", token: r.icon, color: "green" }
    });
  }
  elements.push(greyText(s.projectResumedHint));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.projectResumedTitle },
      subtitle: { tag: "plain_text", content: s.projectResumedSubtitle(project.name) },
      template: "green",
      icon: { tag: "standard_icon", token: "check_outlined", color: "green" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "4px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

export function buildInitSuccessCard(info: {
  projectName: string; id: string; cwd: string; gitUrl: string; operatorId: string; displayName?: string;
}, locale: AppLocale = DEFAULT_APP_LOCALE): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const infoRows = [
    { icon: "edit_outlined", label: s.initSuccessName, value: info.projectName },
    { icon: "hash_outlined", label: s.initSuccessId, value: `\`${info.id}\`` },
    { icon: "folder_outlined", label: s.initSuccessDir, value: `\`${info.cwd}\`` },
    { icon: "sharelink_outlined", label: s.initSuccessRepo, value: info.gitUrl || s.initSuccessLocalGit },
    { icon: "member_outlined", label: s.initSuccessOwner, value: formatUserLabel(info.operatorId, info.displayName) }
  ];

  const elements: unknown[] = [];
  for (const r of infoRows) {
    elements.push({
      tag: "markdown",
      content: `**${r.label}**: ${r.value}`,
      icon: { tag: "standard_icon", token: r.icon, color: "green" }
    });
  }
  elements.push({ tag: "hr" });
  elements.push(greyText(s.initSuccessHint));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.initSuccessTitle },
      subtitle: { tag: "plain_text", content: info.projectName },
      template: "green",
      icon: { tag: "standard_icon", token: "check_outlined", color: "green" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "4px",
      padding: "8px 12px 12px 12px",
      elements
    }
  };
}

export function buildHelpCard(ownerId: string, opts?: {
  isAdmin?: boolean;
  members?: Array<{ userId: string; displayName?: string; role: string }>;
  projectId?: string;
  projectName?: string;
  locale?: AppLocale;
}): Record<string, unknown> {
  const locale = opts?.locale ?? DEFAULT_APP_LOCALE;
  const s = getFeishuCardBuilderStrings(locale);
  const panels = [
    { iconToken: "list-setting_outlined", label: s.helpPanelThreads, desc: s.helpPanelThreadsDesc, action: "help_threads" },
    { iconToken: "mergecells_outlined", label: s.helpPanelMerge, desc: s.helpPanelMergeDesc, action: "help_merge" },
    { iconToken: "time_outlined", label: s.helpPanelHistory, desc: s.helpPanelHistoryDesc, action: "help_history" },
    { iconToken: "history_outlined", label: s.helpPanelTurns, desc: s.helpPanelTurnsDesc, action: "help_turns" },
    { iconToken: "app_outlined", label: s.helpPanelSkills, desc: s.helpPanelSkillsDesc, action: "help_skills" },
    { iconToken: "setting_outlined", label: s.helpPanelBackends, desc: s.helpPanelBackendsDesc, action: "help_backends" }
  ];

  const elements: unknown[] = [];

  for (const p of panels) {
    elements.push({
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      has_border: true,
      border_color: "grey",
      corner_radius: "8px",
      padding: "10px 12px 10px 12px",
      margin: "2px 0",
      behaviors: [{ type: "callback", value: { action: p.action, ownerId } }],
      hover_tips: { tag: "plain_text", content: p.desc },
      elements: [{
        tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
        columns: [
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [{
              tag: "markdown", content: `**${p.label}**`,
              icon: { tag: "standard_icon", token: p.iconToken, color: "turquoise" }
            }]
          },
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [greyText(p.desc)]
          }
        ]
      }]
    });
  }

  // ── 角色管理区（仅 admin 可见）— 用 collapsible_panel 包裹 ──
  if (opts?.isAdmin && opts.members && opts.projectId) {
    const roleOptions = [
      { text: { tag: "plain_text" as const, content: "maintainer" }, value: "maintainer" },
      { text: { tag: "plain_text" as const, content: "developer" }, value: "developer" },
      { text: { tag: "plain_text" as const, content: "auditor" }, value: "auditor" }
    ];

    const memberElements: unknown[] = [];
    if (opts.members.length === 0) {
      memberElements.push(greyText(s.helpNoMembers));
    } else {
      // Header
      memberElements.push({
        tag: "column_set", flex_mode: "none", background_style: "grey", horizontal_spacing: "default",
        columns: [
          { tag: "column", width: "weighted", weight: 2, elements: [{ tag: "markdown", content: s.helpMemberUser, text_size: "notation" }] },
          { tag: "column", width: "weighted", weight: 3, elements: [{ tag: "markdown", content: s.helpMemberRole, text_size: "notation" }] }
        ]
      });
      // Rows
      for (const m of opts.members) {
        memberElements.push({
          tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
          columns: [
            {
              tag: "column", width: "weighted", weight: 2, vertical_align: "center",
              elements: [{ tag: "markdown", content: formatUserLabel(m.userId, m.displayName) }]
            },
            {
              tag: "column", width: "weighted", weight: 3, vertical_align: "center",
              elements: [{
                tag: "select_static",
                placeholder: { tag: "plain_text", content: s.helpSelectRole },
                initial_option: m.role, options: roleOptions,
                behaviors: [{ type: "callback", value: { action: "help_role_change", userId: m.userId, projectId: opts.projectId, ownerId } }]
              }]
            }
          ]
        });
      }
    }

    elements.push({
      tag: "collapsible_panel",
      expanded: false,
      header: {
        title: { tag: "markdown", content: s.helpMemberManagement },
        vertical_align: "center",
        icon: { tag: "standard_icon", token: "expand-down_outlined", size: "16px 16px" },
        icon_position: "right",
        icon_expanded_angle: -180
      },
      border: { color: "grey", corner_radius: "5px" },
      vertical_spacing: "4px",
      padding: "8px 8px 8px 8px",
      elements: memberElements
    });
  }

  elements.push(greyText(s.helpPromptTip));
  elements.push(greyText(s.helpOpenPanelTip));

  const helpTitle = s.helpTitle(opts?.projectName);

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: helpTitle },
      subtitle: { tag: "plain_text", content: s.helpSubtitle },
      template: "turquoise",
      icon: { tag: "standard_icon", token: "helpdesk_outlined", color: "turquoise" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "4px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

export function buildThreadNewCard(
  backends: Array<{ name: string; description?: string; models?: string[] }>,
  defaultBackend?: string,
  defaultModel?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const combinedOptions: Array<{ text: { tag: string; content: string }; value: string }> = [];
  for (const b of backends) {
    if (b.models?.length) {
      for (const m of b.models) {
        combinedOptions.push({
          text: { tag: "plain_text", content: `${b.name} - ${m}` },
          value: `${b.name}:${m}`
        });
      }
    }
  }

  let initialOption = combinedOptions[0]?.value ?? "";
  if (defaultBackend && defaultModel) {
    const candidate = `${defaultBackend}:${defaultModel}`;
    if (combinedOptions.some(o => o.value === candidate)) {
      initialOption = candidate;
    }
  }

  const formElements: unknown[] = [
    {
      tag: "div",
      text: { tag: "plain_text", content: s.threadNameLabel, text_size: "heading-4" }
    },
    { tag: "input", name: "thread_name", placeholder: { tag: "plain_text", content: s.threadNamePlaceholder }, default_value: "" },
    greyText(s.threadNameHint),
    {
      tag: "div",
      text: { tag: "plain_text", content: s.backendModelLabel, text_size: "heading-4" }
    },
    {
      tag: "select_static", name: "backend_model",
      placeholder: { tag: "plain_text", content: s.backendModelPlaceholder },
      initial_option: initialOption, options: combinedOptions
    },
    {
      tag: "button", text: { tag: "plain_text", content: s.createThread },
      type: "primary", size: "medium", width: "fill",
      icon: { tag: "standard_icon", token: "add_outlined" },
      form_action_type: "submit", name: "create_thread_submit",
      behaviors: [{ type: "callback", value: { action: "create_thread" } }]
    }
  ];

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.helpThreadNewTitle },
      subtitle: { tag: "plain_text", content: s.helpThreadNewSubtitle },
      template: "turquoise",
      icon: { tag: "standard_icon", token: "add_outlined", color: "turquoise" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "12px",
      padding: "12px",
      elements: [{
        tag: "form", name: "create_thread_form", element_id: "create_thread_form",
        elements: formElements
      }]
    }
  };
}

export function buildModelListCard(
  currentModel: string,
  availableModels: string[],
  threadName?: string,
  userId?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];

  for (let i = 0; i < availableModels.length; i++) {
    const m = availableModels[i]!;
    const isCurrent = m === currentModel;

    const rightCol = isCurrent
      ? {
        tag: "column", width: "auto", vertical_align: "center",
        elements: [{ tag: "markdown", content: s.currentModelTag, text_align: "right" }]
      }
      : {
        tag: "column", width: "auto", vertical_align: "center",
        elements: [{
          tag: "button", text: { tag: "plain_text", content: s.modelSwitch },
          type: "primary", size: "small", width: "default",
          behaviors: [{ type: "callback", value: { action: "switch_model", model: m, ownerId: userId ?? "" } }]
        }]
      };

    elements.push({
      tag: "column_set",
      flex_mode: "bisect",
      background_style: isCurrent ? "grey" : "default",
      horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [{ tag: "markdown", content: `**${m}**` }]
        },
        rightCol
      ]
    });

    if (i < availableModels.length - 1) {
      elements.push({ tag: "hr" });
    }
  }

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.modelListTitle(threadName) },
      subtitle: { tag: "plain_text", content: s.modelListSubtitle(currentModel) },
      template: "blue"
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

// ── Help Sub-Panel Builders ──────────────────────────────────────────────────

/**
 * Thread management card: thread list + navigation button to create new thread.
 * The create-thread form lives in a separate sub-panel (`buildHelpThreadNewCard`).
 */
export function buildHelpThreadCard(
  threads: Array<{ threadName: string; threadId: string; active?: boolean }>,
  userId: string,
  displayName?: string,
  isOnMain?: boolean,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];

  // ── Main thread row ──
  const mainRightCol = isOnMain
    ? {
      tag: "column", width: "auto", vertical_align: "center",
      elements: [{ tag: "markdown", content: s.threadCurrentReadonly, text_align: "right" }]
    }
    : {
      tag: "column", width: "auto", vertical_align: "center",
      elements: [{
        tag: "button", text: { tag: "plain_text", content: s.threadSwitch },
        type: "default", size: "small", width: "default",
        icon: { tag: "standard_icon", token: "switch_outlined" },
        behaviors: [{ type: "callback", value: { action: "help_switch_to_main", ownerId: userId } }]
      }]
    };
  elements.push({
    tag: "interactive_container",
    width: "fill", height: "auto",
    background_style: "grey", corner_radius: "8px",
    padding: "8px 12px 8px 12px",
    has_border: false, disabled: true,
    elements: [{
      tag: "column_set", flex_mode: "bisect", background_style: "default", horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [{
            tag: "markdown",
            content: s.helpThreadMainDescription,
            icon: { tag: "standard_icon", token: "lock_outlined", color: "grey" }
          }]
        },
        mainRightCol
      ]
    }]
  });

  // ── Other threads ──
  for (const t of threads) {
    const rightCol = t.active
      ? {
        tag: "column", width: "auto", vertical_align: "center",
        elements: [{ tag: "markdown", content: s.threadCurrent, text_align: "right" }]
      }
      : {
        tag: "column", width: "auto", vertical_align: "center",
        elements: [{
          tag: "button", text: { tag: "plain_text", content: s.threadSwitch },
          type: "default", size: "small", width: "default",
          icon: { tag: "standard_icon", token: "switch_outlined" },
          behaviors: [{ type: "callback", value: { action: "help_switch_thread", threadName: t.threadName, ownerId: userId } }]
        }]
      };
    elements.push({
      tag: "interactive_container",
      width: "fill", height: "auto",
      has_border: true, border_color: t.active ? "blue" : "grey", corner_radius: "6px",
      padding: "8px 12px 8px 12px", margin: "4px 0",
      background_style: "default",
      disabled: true,
      elements: [{
        tag: "column_set", flex_mode: "bisect", background_style: "default", horizontal_spacing: "default",
        columns: [
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [{ tag: "markdown", content: `**${t.threadName}**\nID: \`${t.threadId.slice(0, 8)}\`` }]
          },
          rightCol
        ]
      }]
    });
  }

  // ── Navigate to create-thread sub-panel ──
  elements.push({ tag: "hr" });
  elements.push({
    tag: "interactive_container",
    width: "fill", height: "auto",
    has_border: true, border_color: "grey", corner_radius: "8px",
    padding: "10px 12px 10px 12px",
    behaviors: [{ type: "callback", value: { action: "help_thread_new", ownerId: userId } }],
    hover_tips: { tag: "plain_text", content: s.helpThreadNewHover },
    elements: [{
      tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [{
            tag: "markdown", content: s.helpThreadNewEntry,
            icon: { tag: "standard_icon", token: "add_outlined", color: "blue" }
          }]
        },
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [greyText(s.helpThreadNewEntryHint)]
        }
      ]
    }]
  });

  // ── Back button ──
  elements.push({ tag: "hr" });
  elements.push(backPanel(s.helpThreadBack, "help_home"));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.helpThreadTitle },
      subtitle: { tag: "plain_text", content: s.helpThreadSubtitle(displayName) },
      template: "blue",
      icon: { tag: "standard_icon", token: "list-setting_outlined", color: "blue" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: s.threadListCount(threads.length + 1) }, color: "blue" }
      ]
    },
    body: {
      direction: "vertical",
      vertical_spacing: "4px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

/**
 * Create-thread sub-panel — dedicated form card for creating a new thread.
 * Accessed via navigation from `buildHelpThreadCard`.
 */
export function buildHelpThreadNewCard(
  userId: string,
  backends: Array<{ name: string; description?: string; models?: string[]; profiles?: Array<{ name: string; model: string; provider: string }> }>,
  defaultBackend?: string,
  defaultModel?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const combinedOptions: Array<{ text: { tag: string; content: string }; value: string }> = [];
  for (const b of backends) {
    // Prefer profiles over raw models
    if (b.profiles?.length) {
      for (const p of b.profiles) {
        combinedOptions.push({
          text: { tag: "plain_text", content: `${b.name} - ${p.name} (${p.model})` },
          value: `${b.name}:${p.name}:${p.model}`
        });
      }
    } else if (b.models?.length) {
      for (const m of b.models) {
        combinedOptions.push({
          text: { tag: "plain_text", content: `${b.name} - ${m}` },
      value: `${b.name}::${m}`
        });
      }
    }
  }

  let initialOption = combinedOptions[0]?.value ?? "";
  if (defaultBackend && defaultModel) {
    const candidate = combinedOptions.find(o => o.value.startsWith(`${defaultBackend}:`) && o.value.endsWith(defaultModel));
    if (candidate) initialOption = candidate.value;
  }

  const formId = sanitizeElementId("help_new_thread_form");
  const formElements: unknown[] = [
    {
      tag: "div",
      text: { tag: "plain_text", content: s.threadNameLabel, text_size: "heading-4" }
    },
    {
      tag: "input", name: "thread_name",
      placeholder: { tag: "plain_text", content: s.threadNamePlaceholder },
      default_value: ""
    },
    greyText(s.threadNameHint),
    {
      tag: "div",
      text: { tag: "plain_text", content: s.backendModelLabel, text_size: "heading-4" }
    },
    {
      tag: "select_static", name: "backend_model",
      placeholder: { tag: "plain_text", content: s.backendModelPlaceholder },
      initial_option: initialOption, options: combinedOptions
    },
    {
      tag: "button", text: { tag: "plain_text", content: s.createThread },
      type: "primary", size: "medium", width: "fill",
      icon: { tag: "standard_icon", token: "add_outlined" },
      form_action_type: "submit", name: "help_create_thread_submit",
      behaviors: [{ type: "callback", value: { action: "help_create_thread", ownerId: userId } }]
    }
  ];

  const elements: unknown[] = [
    {
      tag: "form", name: formId, element_id: formId,
      elements: formElements
    },
    { tag: "hr" },
    backPanel(s.helpThreadManageBack, "help_threads")
  ];

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.helpThreadNewTitle },
      subtitle: { tag: "plain_text", content: s.helpThreadNewSubtitle },
      template: "blue",
      icon: { tag: "standard_icon", token: "add_outlined", color: "blue" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "12px",
      padding: "12px",
      elements
    }
  };
}

/**
 * Merge management card — entry point for merge operations.
 */
export function buildHelpMergeCard(
  ownerId: string,
  branchName?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];

  if (!branchName) {
    elements.push(greyText(s.helpMergeOnMain));
    elements.push({
      tag: "interactive_container",
      width: "fill", height: "auto",
      has_border: true, border_color: "grey", corner_radius: "8px",
      padding: "10px 12px 10px 12px",
      behaviors: [{ type: "callback", value: { action: "help_threads", ownerId } }],
      elements: [{
        tag: "markdown", content: s.helpMergeGoThreads,
        icon: { tag: "standard_icon", token: "list-setting_outlined", color: "turquoise" }
      }]
    });
  } else {
    elements.push({
      tag: "markdown",
      content: s.helpMergeCurrentBranch(branchName),
      icon: { tag: "standard_icon", token: "mergecells_outlined", color: "green" }
    });
    elements.push({
      tag: "interactive_container",
      width: "fill", height: "auto",
      has_border: true, border_color: "grey", corner_radius: "8px",
      padding: "10px 12px 10px 12px",
      behaviors: [{ type: "callback", value: { action: "help_merge_preview", ownerId, branchName } }],
      elements: [{
        tag: "markdown", content: s.helpMergePreview(branchName),
        icon: { tag: "standard_icon", token: "switch_outlined", color: "green" }
      }]
    });
  }

  elements.push({ tag: "hr" });
  elements.push(backPanel(s.helpMergeBack, "help_home"));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.helpMergeTitle },
      subtitle: { tag: "plain_text", content: s.helpMergeSubtitle(branchName) },
      template: branchName ? "green" : "grey",
      icon: { tag: "standard_icon", token: "mergecells_outlined", color: branchName ? "green" : "grey" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

/**
 * Skill management card — list + install + remove (full CRUD).
 */
export function buildHelpSkillCard(
  skills: Array<{ name: string; description: string; installed: boolean }>,
  ownerId: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const txt = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];
  const DESCRIPTION_LIMIT = 96;

  if (skills.length === 0) {
    elements.push(greyText(txt.helpSkillEmpty));
  } else {
    for (const s of skills) {
      const statusTag = s.installed ? txt.helpSkillInstalled : txt.helpSkillNotInstalled;
      const actionBtn = s.installed
        ? {
          tag: "button", text: { tag: "plain_text", content: txt.helpSkillRemove },
          type: "danger", size: "small",
          icon: { tag: "standard_icon", token: "delete_outlined" },
          confirm: {
            title: { tag: "plain_text", content: txt.helpSkillRemoveConfirmTitle(s.name) },
            text: { tag: "plain_text", content: txt.helpSkillRemoveConfirmText }
          },
          behaviors: [{ type: "callback", value: { action: "help_skill_remove", name: s.name, ownerId } }]
        }
        : {
          tag: "button", text: { tag: "plain_text", content: txt.helpSkillInstall },
          type: "primary", size: "small",
          icon: { tag: "standard_icon", token: "download_outlined" },
          behaviors: [{ type: "callback", value: { action: "help_skill_install", skillName: s.name, ownerId } }]
        };

      elements.push({
        tag: "interactive_container",
        width: "fill", height: "auto",
        has_border: true, border_color: "grey", corner_radius: "6px",
        padding: "8px 12px 8px 12px", margin: "2px 0",
        disabled: true,
        elements: [{
          tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
          columns: [
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [
                {
                  tag: "markdown",
                  content: `**${s.name}** ${statusTag}`,
                  icon: { tag: "standard_icon", token: "app_outlined", color: "indigo" }
                },
                greyText(
                  `> ${(() => {
                    const description = String(s.description || txt.helpSkillNoDescription).trim();
                    return description.length > DESCRIPTION_LIMIT
                      ? `${description.slice(0, DESCRIPTION_LIMIT)}…`
                      : description;
                  })()}`
                )
              ]
            },
            {
              tag: "column", width: "auto", vertical_align: "center",
              elements: [actionBtn]
            }
          ]
        }]
      });
    }
  }

  elements.push({ tag: "hr" });
  elements.push(backPanel(txt.helpSkillBack, "help_home"));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: txt.helpSkillTitle },
      subtitle: { tag: "plain_text", content: txt.helpSkillSubtitle(skills.filter(s => s.installed).length, skills.length) },
      template: "indigo",
      icon: { tag: "standard_icon", token: "app_outlined", color: "indigo" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "4px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

/**
 * Backend overview card — read-only view of all backend · model pairs.
 */
export function buildHelpBackendCard(
  backends: Array<{ name: string; description?: string; models?: string[] }>,
  ownerId: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];

  if (backends.length === 0) {
    elements.push(greyText(s.helpBackendEmpty));
  } else {
    for (const b of backends) {
      const models = b.models ?? [];
      const modelList = models.length > 0
        ? models.map(m => `\`${m}\``).join("  ·  ")
        : s.helpBackendNoModels;

      elements.push({
        tag: "collapsible_panel",
        expanded: true,
        header: {
          title: { tag: "markdown", content: `**${b.name}**` },
          vertical_align: "center",
          icon: { tag: "standard_icon", token: "setting_outlined", color: "turquoise", size: "16px 16px" },
          icon_position: "follow_text",
          icon_expanded_angle: 0
        },
        border: { color: "grey", corner_radius: "8px" },
        vertical_spacing: "4px",
        padding: "8px 12px 8px 12px",
        elements: [
          { tag: "markdown", content: modelList },
          ...(b.description ? [greyText(b.description)] : [])
        ]
      });
    }
  }

  elements.push(greyText(s.helpBackendHint));
  elements.push({ tag: "hr" });
  elements.push(backPanel(s.helpBackendBack, "help_home"));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.helpBackendTitle },
      subtitle: { tag: "plain_text", content: s.helpBackendSubtitle(backends.length) },
      template: "turquoise",
      icon: { tag: "standard_icon", token: "setting_outlined", color: "turquoise" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "4px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

// ── Admin Panel Builders ─────────────────────────────────────────────────────

export function buildAdminHelpCard(locale: AppLocale = DEFAULT_APP_LOCALE): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const panels = [
    { iconToken: "folder_outlined", label: s.adminPanels[0]!.label, desc: s.adminPanels[0]!.desc, action: "admin_panel_project" },
    { iconToken: "member_outlined", label: s.adminPanels[1]!.label, desc: s.adminPanels[1]!.desc, action: "admin_panel_user" },
    { iconToken: "group_outlined", label: s.adminPanels[2]!.label, desc: s.adminPanels[2]!.desc, action: "admin_panel_member" },
    { iconToken: "app_outlined", label: s.adminPanels[3]!.label, desc: s.adminPanels[3]!.desc, action: "admin_panel_skill" },
    { iconToken: "setting_outlined", label: s.adminPanels[4]!.label, desc: s.adminPanels[4]!.desc, action: "admin_panel_backend" }
  ];

  const elements: unknown[] = [];
  for (const p of panels) {
    elements.push({
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      has_border: true,
      border_color: "grey",
      corner_radius: "8px",
      padding: "10px 12px 10px 12px",
      margin: "2px 0",
      behaviors: [{ type: "callback", value: { action: p.action } }],
      hover_tips: { tag: "plain_text", content: p.desc },
      elements: [{
        tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
        columns: [
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [{
              tag: "markdown", content: `**${p.label}**`,
              icon: { tag: "standard_icon", token: p.iconToken, color: "orange" }
            }]
          },
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [greyText(p.desc)]
          }
        ]
      }]
    });
  }

  elements.push(greyText(s.adminPrivateOnly));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminHelpTitle },
      subtitle: { tag: "plain_text", content: s.adminHelpSubtitle },
      template: "orange",
      icon: { tag: "standard_icon", token: "setting_outlined", color: "orange" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "4px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

export function buildAdminProjectCard(
  data: IMAdminProjectPanel,
  searchKeyword?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];

  // 搜索框
  elements.push(searchForm("admin_search_project", s.adminProjectSearchPlaceholder, searchKeyword, locale));

  if (data.projects.length === 0) {
    elements.push(greyText(s.adminProjectEmpty(searchKeyword)));
  } else {
    for (const p of data.projects) {
      const statusColor = p.status === "active" ? "green" : "red";
      const gitInfo = p.gitUrl ? p.gitUrl : s.localGitLabel;

      // Action buttons
      const actionButtons: unknown[] = [
        {
          tag: "button",
          text: { tag: "plain_text", content: s.adminProjectEdit },
          type: "default", size: "small",
          icon: { tag: "standard_icon", token: "edit_outlined" },
          behaviors: [{ type: "callback", value: { action: "admin_project_edit", projectId: p.id } }]
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: p.status === "active" ? s.adminProjectDisable : s.adminProjectEnable },
          type: p.status === "active" ? "default" : "primary",
          size: "small",
          icon: { tag: "standard_icon", token: "switch_outlined" },
          behaviors: [{ type: "callback", value: { action: "admin_project_toggle", projectId: p.id } }]
        }
      ];

      if (p.chatId) {
        actionButtons.push({
          tag: "button",
          text: { tag: "plain_text", content: s.adminProjectUnbind },
          type: "danger", size: "small",
          icon: { tag: "standard_icon", token: "cancel-link_outlined" },
          confirm: {
            title: { tag: "plain_text", content: s.adminProjectUnbindConfirmTitle(p.name) },
            text: { tag: "plain_text", content: s.adminProjectUnbindConfirmText }
          },
          behaviors: [{ type: "callback", value: { action: "admin_project_unbind", projectId: p.id } }]
        });
      }

      actionButtons.push({
        tag: "button",
        text: { tag: "plain_text", content: s.adminProjectDelete },
        type: "danger", size: "small",
        icon: { tag: "standard_icon", token: "delete_outlined" },
        confirm: {
          title: { tag: "plain_text", content: s.adminProjectDeleteConfirmTitle(p.name) },
          text: { tag: "plain_text", content: s.adminProjectDeleteConfirmText }
        },
        behaviors: [{ type: "callback", value: { action: "admin_project_delete", projectId: p.id } }]
      });

      // Wrap entire project in interactive_container (unified with member card style)
      elements.push({
        tag: "interactive_container",
        width: "fill", height: "auto",
        has_border: true,
        border_color: p.status === "active" ? "grey" : "red",
        corner_radius: "8px",
        padding: "8px 12px 8px 12px",
        margin: "4px 0",
        disabled: true,
        elements: [
          {
            tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
            columns: [{
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [{
                tag: "markdown",
                content: `**${p.name}**  <text_tag color='${statusColor}'>${p.status}</text_tag>`,
                icon: { tag: "standard_icon", token: "folder_outlined", color: "blue" }
              }]
            }]
          },
          greyText(`${p.cwd}  ·  ${s.adminProjectMemberCount(p.memberCount)}  ·  ${gitInfo}`),
          {
            tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
            columns: [
              { tag: "column", width: "weighted", weight: 1, elements: [] },
              ...actionButtons.map(btn => ({
                tag: "column", width: "auto", vertical_align: "center",
                elements: [btn]
              }))
            ]
          }
        ]
      });
    }
  }

  elements.push({ tag: "hr" });
  elements.push(backPanel(s.adminProjectBack, "admin_panel_home"));

  const subtitle = s.adminProjectSubtitle(searchKeyword);
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminProjectTitle },
      subtitle: { tag: "plain_text", content: subtitle },
      template: "blue",
      icon: { tag: "standard_icon", token: "folder_outlined", color: "blue" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: s.adminProjectCount(data.projects.length) }, color: "neutral" }
      ]
    },
    body: { direction: "vertical", vertical_spacing: "4px", padding: "4px 12px 12px 12px", elements }
  };
}

/**
 * Inline edit form for a project — allows changing name and gitUrl.
 */
export function buildAdminProjectEditCard(project: { id: string; name: string; gitUrl?: string; chatId?: string }): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(DEFAULT_APP_LOCALE);
  const formElements: unknown[] = [
    {
      tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
      columns: [{
        tag: "column", width: "fill", vertical_align: "center",
        elements: [{ tag: "markdown", content: s.adminProjectNameLabel, icon: { tag: "standard_icon", token: "edit_outlined", color: "blue" } }]
      }]
    },
    {
      tag: "input", name: "project_name",
      placeholder: { tag: "plain_text", content: s.adminProjectNamePlaceholder },
      default_value: project.name
    },
    {
      tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
      columns: [{
        tag: "column", width: "fill", vertical_align: "center",
        elements: [{ tag: "markdown", content: s.adminProjectGitUrlLabel, icon: { tag: "standard_icon", token: "sharelink_outlined", color: "blue" } }]
      }]
    },
    {
      tag: "input", name: "git_url",
      placeholder: { tag: "plain_text", content: "https://github.com/org/repo.git" },
      default_value: project.gitUrl ?? ""
    },
  ];

  // Chat binding section (outside form — rebind is a separate action)
  const chatElements: unknown[] = [
    { tag: "hr" },
    {
      tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
      columns: [{
        tag: "column", width: "fill", vertical_align: "center",
        elements: [{ tag: "markdown", content: s.adminProjectChatBindingLabel, icon: { tag: "standard_icon", token: "chat_outlined", color: "blue" } }]
      }]
    },
    greyText(project.chatId ? s.adminProjectCurrentBinding(project.chatId) : s.adminProjectNoBinding),
  ];

  if (project.chatId) {
    chatElements.push({
      tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
      columns: [
        { tag: "column", width: "weighted", weight: 1, elements: [] },
        {
          tag: "column", width: "auto", vertical_align: "center",
          elements: [{
            tag: "button",
            text: { tag: "plain_text", content: s.adminProjectUnbindChat },
            type: "danger", size: "small",
            icon: { tag: "standard_icon", token: "cancel-link_outlined" },
            confirm: {
              title: { tag: "plain_text", content: s.adminProjectUnbindChatConfirmTitle },
              text: { tag: "plain_text", content: s.adminProjectUnbindChatConfirmText }
            },
            behaviors: [{ type: "callback", value: { action: "admin_project_unbind", projectId: project.id } }]
          }]
        }
      ]
    });
  }

  // Bottom bar: save (inside form) + back (outside form), side by side
  const saveButton = {
    tag: "button",
    text: { tag: "plain_text", content: s.save },
    type: "primary", size: "small",
    icon: { tag: "standard_icon", token: "check_outlined" },
    form_action_type: "submit",
    name: "admin_project_save_submit",
    behaviors: [{ type: "callback", value: { action: "admin_project_save", projectId: project.id } }]
  };

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminProjectEditTitle },
      subtitle: { tag: "plain_text", content: `${project.name}  (${project.id})` },
      template: "blue",
      icon: { tag: "standard_icon", token: "edit_outlined", color: "blue" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "8px 12px 12px 12px",
      elements: [
        {
          tag: "form",
          name: "admin_project_edit_form",
          element_id: "admin_project_edit_form",
          elements: [
            ...formElements,
            ...chatElements,
            { tag: "hr" },
            {
              tag: "column_set", flex_mode: "bisect", horizontal_spacing: "default",
              columns: [
                {
                  tag: "column", width: "weighted", weight: 1, vertical_align: "center",
                  elements: [{
                    tag: "button",
                    //margin: "10px 12px 10px 12px",
                    size: "large",
                    width: "fill",
                    text: { tag: "plain_text", content: s.save },
                    type: "primary",
                    icon: { tag: "standard_icon", token: "check_outlined" },
                    form_action_type: "submit",
                    name: "admin_project_save_submit",
                    behaviors: [{ type: "callback", value: { action: "admin_project_save", projectId: project.id } }]
                  }]
                },
                {
                  tag: "column", width: "weighted", weight: 1, vertical_align: "center",
                  elements: [backPanel(s.adminProjectEditBack, "admin_panel_project")]
                }
              ]
            }
          ]
        },
      ]
    }
  };
}

export function buildAdminUserCard(
  data: IMAdminUserPanel,
  searchKeyword?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];
  const PAGE_SIZE = data.pageSize;
  const totalPages = Math.ceil(data.total / PAGE_SIZE);

  // 搜索框
  elements.push(searchForm("admin_search_user", s.adminUserSearchPlaceholder, searchKeyword, locale));

  if (data.users.length === 0) {
    elements.push(greyText(s.adminUserEmpty(searchKeyword)));
  } else {
    for (const u of data.users) {
      const roleLabel = u.sysRole === 1 ? "admin" : "user";
      const sourceLabel = u.source === "env" ? s.adminUserSourceLockedEnv : s.adminUserSourceFeishu;

      const actionElement = u.source === "env"
        ? greyText(s.adminUserLocked)
        : u.sysRole === 1
          ? {
            tag: "button", text: { tag: "plain_text", content: s.adminUserDemote },
            type: "danger", size: "small",
            icon: { tag: "standard_icon", token: "switch_outlined" },
            confirm: {
              title: { tag: "plain_text", content: s.adminUserDemoteConfirmTitle(formatUserLabel(u.userId, u.displayName)) },
              text: { tag: "plain_text", content: s.adminUserDemoteConfirmText }
            },
            behaviors: [{ type: "callback", value: { action: "admin_toggle", userId: u.userId, promote: false, page: data.page } }]
          }
          : {
            tag: "button", text: { tag: "plain_text", content: s.adminUserPromote },
            type: "primary", size: "small",
            icon: { tag: "standard_icon", token: "switch_outlined" },
            behaviors: [{ type: "callback", value: { action: "admin_toggle", userId: u.userId, promote: true, page: data.page } }]
          };

      elements.push({
        tag: "interactive_container",
        width: "fill", height: "auto",
        has_border: true, border_color: "grey", corner_radius: "8px",
        padding: "10px 12px 10px 12px",
        margin: "2px 0",
        elements: [{
          tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
          columns: [
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [
                { tag: "markdown", content: `**${formatUserLabel(u.userId, u.displayName)}**  ${roleLabel}`, icon: { tag: "standard_icon", token: "member_outlined", color: "purple" } },
                greyText(sourceLabel)
              ]
            },
            {
              tag: "column", width: "auto", vertical_align: "center",
              elements: [actionElement]
            }
          ]
        }]
      });
    }
  }

  // Pagination (hide when searching — results are not paginated)
  if (totalPages > 1 && !searchKeyword) {
    elements.push({ tag: "hr" });
    const prevDisabled = data.page <= 0;
    const nextDisabled = data.page >= totalPages - 1;
    elements.push({
      tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "auto", vertical_align: "center",
          elements: [{
            tag: "button", text: { tag: "plain_text", content: s.previousPage },
            icon: { tag: "standard_icon", token: "arrow-left_outlined" },
            type: "default", size: "small", disabled: prevDisabled,
            behaviors: [{ type: "callback", value: { action: "admin_user_page", page: data.page - 1 } }]
          }]
        },
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [greyText(`${data.page + 1} / ${totalPages}`)]
        },
        {
          tag: "column", width: "auto", vertical_align: "center",
          elements: [{
            tag: "button", text: { tag: "plain_text", content: s.nextPage },
            type: "default", size: "small", disabled: nextDisabled,
            behaviors: [{ type: "callback", value: { action: "admin_user_page", page: data.page + 1 } }]
          }]
        }
      ]
    });
  }

  elements.push({ tag: "hr" });
  elements.push(backPanel(s.adminConsoleBack, "admin_panel_home"));

  const subtitle = s.adminUserSubtitle(searchKeyword);
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminUserTitle },
      subtitle: { tag: "plain_text", content: subtitle },
      template: "purple",
      icon: { tag: "standard_icon", token: "member_outlined", color: "purple" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: s.adminUserCount(data.total) }, color: "neutral" }
      ]
    },
    body: { direction: "vertical", vertical_spacing: "4px", padding: "4px 12px 12px 12px", elements }
  };
}

export function buildAdminMemberCard(
  data: IMAdminMemberPanel,
  searchKeyword?: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];
  const roleOptions = [
    { text: { tag: "plain_text" as const, content: "maintainer" }, value: "maintainer" },
    { text: { tag: "plain_text" as const, content: "developer" }, value: "developer" },
    { text: { tag: "plain_text" as const, content: "auditor" }, value: "auditor" }
  ];

  // 搜索框
  elements.push(searchForm("admin_search_member", s.adminMemberSearchPlaceholder, searchKeyword, locale));

  if (data.projects.length === 0) {
    elements.push({ tag: "markdown", content: s.adminMemberEmpty(searchKeyword) });
  } else {
    for (const project of data.projects) {
      elements.push({
        tag: "markdown",
        content: s.adminMemberProjectLine(project.projectName, project.members.length),
        icon: { tag: "standard_icon", token: "folder_outlined", color: "purple" }
      });

      if (project.members.length === 0) {
        elements.push(greyText(s.adminMemberNoMembers));
      } else {
        for (const m of project.members) {
          elements.push({
            tag: "interactive_container",
            width: "fill", height: "auto",
            has_border: true, border_color: "grey", corner_radius: "8px",
            padding: "8px 12px 8px 12px",
            margin: "2px 0",
            elements: [{
              tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
              columns: [
                {
                  tag: "column", width: "weighted", weight: 1, vertical_align: "center",
                  elements: [{
                    tag: "markdown",
                    content: `**${formatUserLabel(m.userId, m.displayName)}**`,
                    icon: { tag: "standard_icon", token: "member_outlined", color: "purple" }
                  }]
                },
                {
                  tag: "column", width: "auto", vertical_align: "center",
                  elements: [{
                    tag: "select_static",
                    placeholder: { tag: "plain_text", content: s.adminMemberSelectRole },
                    initial_option: m.role, options: roleOptions,
                    behaviors: [{ type: "callback", value: { action: "admin_member_role_change", userId: m.userId, projectId: project.projectId } }]
                  }]
                }
              ]
            }]
          });
        }
      }
      elements.push({ tag: "hr" });
    }
  }

  elements.push(greyText(s.adminMemberHint));
  elements.push(backPanel(s.adminMemberBack, "admin_panel_home"));

  const totalMembers = data.projects.reduce((sum, p) => sum + p.members.length, 0);
  const subtitle = s.adminMemberSubtitle(searchKeyword);
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminMemberTitle },
      subtitle: { tag: "plain_text", content: subtitle },
      template: "purple",
      icon: { tag: "standard_icon", token: "group_outlined", color: "purple" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: s.adminMemberCount(totalMembers) }, color: "neutral" }
      ]
    },
    body: { direction: "vertical", vertical_spacing: "4px", padding: "4px 12px 12px 12px", elements }
  };
}

export function buildAdminSkillCard(data: IMAdminSkillPanel, locale: AppLocale = DEFAULT_APP_LOCALE): Record<string, unknown> {
  const txt = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];
  const enabled = data.plugins.filter((p) => p.enabled).length;
  const downloaded = data.plugins.filter((p) => p.downloaded).length;
  const summarizeDescription = (description?: string): { short: string; long: string | null } => {
    const normalized = (description ?? "").trim();
    if (!normalized) return { short: txt.adminSkillNoDescription, long: null };
    if (normalized.length <= 160) return { short: normalized, long: null };
    return { short: `${normalized.slice(0, 157)}…`, long: normalized };
  };

  elements.push({
    tag: "column_set",
    flex_mode: "none",
    background_style: "default",
    columns: [
      {
        tag: "column", width: "weighted", weight: 1, vertical_align: "center",
        elements: [{
          tag: "button",
          text: { tag: "plain_text", content: txt.adminSkillGithubInstall },
          width: "fill",
          icon: { tag: "standard_icon", token: "download_outlined" },
          behaviors: [{ type: "callback", value: { action: "admin_skill_install_open", installMode: "github_subpath" } }]
        }]
      },
      {
        tag: "column", width: "weighted", weight: 1, vertical_align: "center",
        elements: [{
          tag: "button",
          text: { tag: "plain_text", content: txt.adminSkillFeishuInstall },
          width: "fill",
          behaviors: [{ type: "callback", value: { action: "admin_skill_file_install_open" } }]
        }]
      }
    ]
  });
  elements.push({
    tag: "column_set",
    flex_mode: "none",
    background_style: "default",
    columns: [
      {
        tag: "column", width: "weighted", weight: 1, vertical_align: "center",
        elements: [{
          tag: "button",
          text: { tag: "plain_text", content: txt.adminSkillRefresh },
          width: "fill",
          behaviors: [{ type: "callback", value: { action: "admin_panel_skill" } }]
        }]
      },
      {
        tag: "column", width: "weighted", weight: 1, vertical_align: "center",
        elements: []
      }
    ]
  });
  elements.push(greyText(`${txt.adminSkillCurrentProject(data.projectName)} · ${txt.adminSkillDownloaded(downloaded)} · ${txt.adminSkillEnabled(enabled)}`));
  if (data.installTasks?.length) {
    elements.push({
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      has_border: true,
      border_color: "blue",
      corner_radius: "8px",
      padding: "8px 12px 8px 12px",
      margin: "2px 0",
      disabled: true,
      elements: data.installTasks.slice(0, 5).map((task) => ({
        tag: "markdown",
        content: `${task.status === "running" ? "⏳" : task.status === "success" ? "✅" : "❌"} **${task.label}**\n${task.detail ?? ""}`.trim()
      }))
    });
  }
  elements.push({ tag: "hr" });

  if (data.plugins.length === 0) {
    elements.push(greyText(txt.adminSkillEmpty));
  } else {
    for (const s of data.plugins) {
      const tags = [
        s.downloaded ? txt.adminSkillTagDownloaded : txt.adminSkillTagNotDownloaded,
        s.enabled ? txt.adminSkillTagEnabled : txt.adminSkillTagNotEnabled,
        s.hasMcpServers ? txt.adminSkillTagHasMcp : "",
      ].filter(Boolean).join(" ");
      const desc = summarizeDescription(s.description);
      const actionButton = !s.downloaded
        ? {
          tag: "button", text: { tag: "plain_text", content: txt.adminSkillPendingDownload }, disabled: true, size: "small", width: "default"
        }
        : !data.projectId
          ? null
        : s.enabled
          ? {
            tag: "button", text: { tag: "plain_text", content: txt.adminSkillDisable },
            type: "default", size: "small", width: "default",
            behaviors: [{ type: "callback", value: { action: "admin_skill_unbind", pluginName: s.pluginName } }]
          }
          : {
            tag: "button", text: { tag: "plain_text", content: txt.adminSkillEnable },
            type: "primary", size: "small", width: "default",
            behaviors: [{ type: "callback", value: { action: "admin_skill_bind", pluginName: s.pluginName } }]
          };
      elements.push({
        tag: "interactive_container",
        width: "fill",
        height: "auto",
        has_border: true,
        border_color: "grey",
        corner_radius: "6px",
        padding: "8px 12px 8px 12px",
        margin: "2px 0",
        disabled: true,
        elements: [
          {
            tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
            columns: [
              {
                tag: "column", width: "weighted", weight: 1, vertical_align: "center",
                elements: [{
                  tag: "markdown", content: `**${s.name ?? s.pluginName ?? "—"}**\n${tags}`,
                  icon: { tag: "standard_icon", token: "app_outlined", color: "indigo" }
                }]
              },
              ...(actionButton ? [{
                tag: "column", width: "auto", vertical_align: "center",
                elements: [actionButton]
              }] : [])
            ]
          },
          { tag: "markdown", content: desc.short },
          {
            tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
            columns: [
              {
                tag: "column", width: "weighted", weight: 1, vertical_align: "center",
                elements: [
                  greyText(`${pluginSourceLabel(s.sourceType, locale)}`),
                  ...(s.downloadedAt ? [greyText(txt.adminSkillDownloadedAt(s.downloadedAt.slice(0, 16).replace("T", " ")))] : []),
                  ...(!data.projectId ? [greyText(txt.adminSkillUnboundHint)] : []),
                ]
              }
            ]
          },
          ...(desc.long ? [{
            tag: "collapsible_panel",
            expanded: false,
            header: {
              title: { tag: "plain_text", content: txt.adminSkillViewFullDescription },
              icon: { tag: "standard_icon", token: "expand-down_outlined", color: "grey", size: "16px 16px" },
              icon_position: "follow_text",
              icon_expanded_angle: -180
            },
            vertical_spacing: "2px",
            border: { color: "grey" },
            elements: [{ tag: "markdown", content: desc.long }]
          }] : [])
        ]
      });
    }
  }

  elements.push({ tag: "hr" });
  elements.push(backPanel(txt.adminSkillBack, "admin_panel_home"));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: txt.adminSkillTitle },
      subtitle: { tag: "plain_text", content: txt.adminSkillSubtitle(data.projectName) },
      template: "indigo",
      icon: { tag: "standard_icon", token: "app_outlined", color: "indigo" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: txt.adminSkillCount(data.plugins.length) }, color: "neutral" }
      ]
    },
    body: { direction: "vertical", vertical_spacing: "4px", padding: "4px 12px 12px 12px", elements }
  };
}

export function buildAdminSkillInstallCard(locale: AppLocale = DEFAULT_APP_LOCALE): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const formId = sanitizeElementId("admin_skill_install");
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminSkillInstallTitle },
      subtitle: { tag: "plain_text", content: s.adminSkillInstallSubtitle },
      template: "indigo",
      icon: { tag: "standard_icon", token: "download_outlined", color: "indigo" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements: [
        greyText(s.adminSkillInstallHint),
        {
          tag: "form", name: formId, element_id: formId,
          elements: [
            { tag: "input", name: "skill_source", placeholder: { tag: "plain_text", content: s.adminSkillInstallSourcePlaceholder } },
            { tag: "input", name: "skill_subpath", placeholder: { tag: "plain_text", content: s.adminSkillInstallSubpathPlaceholder } },
            { tag: "input", name: "skill_name", placeholder: { tag: "plain_text", content: s.adminSkillInstallNamePlaceholder } },
            {
              tag: "select_static",
              name: "skill_auto_enable",
              placeholder: { tag: "plain_text", content: s.adminSkillInstallActionPlaceholder },
              options: [
                { text: { tag: "plain_text", content: s.adminSkillInstallCatalogOnly }, value: "catalog" },
                { text: { tag: "plain_text", content: s.adminSkillInstallToProject }, value: "project" },
              ],
              initial_option: "catalog",
              value: { key: "skill_auto_enable" }
            },
            {
              tag: "button",
              name: "admin_skill_install_submit",
              text: { tag: "plain_text", content: s.adminSkillInstallStart },
              type: "primary",
              width: "fill",
              form_action_type: "submit",
              behaviors: [{ type: "callback", value: { action: "admin_skill_install_submit", installMode: "github_subpath" } }]
            }
          ]
        },
        { tag: "hr" },
        backPanel(s.adminSkillInstallBack, "admin_panel_skill")
      ]
    }
  };
}

type AdminSkillFileInstallCardMode = "idle" | "awaiting_upload";

export function buildAdminSkillFileInstallCard(
  options?: { mode?: AdminSkillFileInstallCardMode },
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const mode = options?.mode ?? "idle";
  const copy = mode === "awaiting_upload"
    ? {
      subtitle: s.adminSkillFileWaitingSubtitle,
      hint: s.adminSkillFileWaitingHint,
      buttonText: s.adminSkillFileWaitingButton,
      buttonType: "default" as const,
    }
    : {
      subtitle: s.adminSkillFileIdleSubtitle,
      hint: s.adminSkillFileIdleHint,
      buttonText: s.adminSkillFileIdleButton,
      buttonType: "primary" as const,
    };
  const formId = sanitizeElementId("admin_skill_file_install");
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminSkillFileTitle },
      subtitle: { tag: "plain_text", content: copy.subtitle },
      template: "indigo",
      icon: { tag: "standard_icon", token: "upload_outlined", color: "indigo" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements: [
        greyText(copy.hint),
        {
          tag: "form", name: formId, element_id: formId,
          elements: [
            {
              tag: "select_static",
              name: "skill_auto_enable",
              placeholder: { tag: "plain_text", content: s.adminSkillFileActionPlaceholder },
              options: [
                { text: { tag: "plain_text", content: s.adminSkillInstallCatalogOnly }, value: "catalog" },
                { text: { tag: "plain_text", content: s.adminSkillInstallToProject }, value: "project" },
              ],
              initial_option: "catalog",
              value: { key: "skill_auto_enable" }
            },
            {
              tag: "button",
              name: "admin_skill_file_install_submit",
              text: { tag: "plain_text", content: copy.buttonText },
              type: copy.buttonType,
              width: "fill",
              form_action_type: "submit",
              behaviors: [{ type: "callback", value: { action: "admin_skill_file_install_submit" } }]
            }
          ]
        },
        { tag: "hr" },
        backPanel(s.adminSkillFileBack, "admin_panel_skill")
      ]
    }
  };
}

export function buildAdminSkillFileConfirmCard(data: {
  fileName: string;
  pluginName: string;
  manifestName?: string;
  manifestDescription?: string;
  sourceLabel?: string;
  archiveFormat?: string;
  autoEnableProject?: boolean;
  projectName?: string;
  expiresHint?: string;
  validationError?: string;
}, locale: AppLocale = DEFAULT_APP_LOCALE): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const formId = sanitizeElementId("admin_skill_file_confirm");
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminSkillFileConfirmTitle },
      subtitle: { tag: "plain_text", content: s.adminSkillFileConfirmSubtitle },
      template: "orange",
      icon: { tag: "standard_icon", token: "warning_outlined", color: "orange" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements: [
        {
          tag: "interactive_container",
          width: "fill",
          height: "auto",
          has_border: true,
          border_color: "orange",
          corner_radius: "8px",
          padding: "10px 12px 10px 12px",
          elements: [{
            tag: "markdown",
            content: s.adminSkillFileConfirmExpires(data.expiresHint ?? s.adminSkillFileDefaultHint),
            icon: { tag: "standard_icon", token: "warning_outlined", color: "orange" }
          }]
        },
        ...(data.validationError ? [{
          tag: "interactive_container",
          width: "fill",
          height: "auto",
          has_border: true,
          border_color: "red",
          corner_radius: "8px",
          padding: "10px 12px 10px 12px",
          elements: [{
            tag: "markdown",
            content: s.adminSkillFileConfirmValidation(data.validationError),
            icon: { tag: "standard_icon", token: "close_circle_outlined", color: "red" }
          }]
        }] : []),
        greyText(s.adminSkillFileLabelFile(data.fileName)),
        greyText(s.adminSkillFileLabelSource(data.sourceLabel ?? s.adminSkillFileDefaultSource)),
        greyText(s.adminSkillFileLabelArchive(data.archiveFormat ?? s.adminSkillFileDefaultArchive)),
        greyText(s.adminSkillFileLabelManifest(data.manifestName ?? s.adminSkillFileLabelManifestFallback)),
        ...(data.manifestDescription ? [greyText(s.adminSkillFileLabelManifestDescription(data.manifestDescription))] : []),
        greyText(s.adminSkillFileLabelPostAction(
          data.autoEnableProject ? s.adminSkillFilePostAction(data.projectName) : s.adminSkillFileCatalogOnly
        )),
        {
          tag: "form", name: formId, element_id: formId,
          elements: [
            {
              tag: "input",
              name: "skill_name",
              default_value: data.pluginName,
              placeholder: { tag: "plain_text", content: s.adminSkillFileFinalNamePlaceholder }
            },
            {
              tag: "column_set",
              flex_mode: "none",
              background_style: "default",
              columns: [
                {
                  tag: "column", width: "weighted", weight: 1, vertical_align: "center",
                  elements: [{
                    name: "admin_skill_file_install_confirm_submit",
                    tag: "button",
                    text: { tag: "plain_text", content: s.adminSkillFileConfirmInstall },
                    type: "primary",
                    width: "fill",
                    form_action_type: "submit",
                    behaviors: [{ type: "callback", value: { action: "admin_skill_file_install_confirm" } }]
                  }]
                },
                {
                  tag: "column", width: "weighted", weight: 1, vertical_align: "center",
                  elements: [{
                    tag: "button",
                    text: { tag: "plain_text", content: s.adminSkillFileCancel },
                    width: "fill",
                    behaviors: [{ type: "callback", value: { action: "admin_skill_file_install_cancel" } }]
                  }]
                }
              ]
            }
          ]
        },
        { tag: "hr" },
        backPanel(s.adminSkillFileBack, "admin_panel_skill")
      ]
    }
  };
}

export function buildAdminBackendCard(data: IMAdminBackendPanel, locale: AppLocale = DEFAULT_APP_LOCALE): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const INSTALL_HINTS: Record<string, string> = {
    "codex": "npm i -g @openai/codex",
    "claude-code": "npm i -g @anthropic-ai/claude-code",
    "opencode": "npm i -g opencode",
  };

  const elements: unknown[] = [];

  if (data.backends.length === 0) {
    elements.push(greyText(s.adminBackendEmpty));
  } else {
    for (const b of data.backends) {
      const profileCount = (b.profiles ?? []).length;
      const statusIcon = b.cmdAvailable ? "✓" : "✗";
      const modelInfo = profileCount > 0 ? s.adminBackendProfileCount(profileCount) : s.adminBackendNoModels;
      const installHint = !b.cmdAvailable && b.providers.length === 0
        ? s.adminBackendInstallHint(INSTALL_HINTS[b.name] ?? b.serverCmd)
        : "";

      elements.push(navEntry({
        icon: "setting_outlined",
        title: `${b.name}  ${statusIcon}`,
        subtitle: s.adminBackendProviderCount(b.providers.length, modelInfo, installHint),
        action: "admin_backend_edit",
        actionValue: { backend: b.name }
      }));
    }
  }

  elements.push({ tag: "hr" });
  elements.push(backPanel(s.adminBackendBack, "admin_panel_home"));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminBackendTitle },
      subtitle: { tag: "plain_text", content: s.adminBackendSubtitle },
      template: "turquoise",
      icon: { tag: "standard_icon", token: "setting_outlined", color: "turquoise" },
      text_tag_list: [{
        tag: "text_tag",
        text: { tag: "plain_text", content: s.adminBackendCount(data.backends.length) },
        color: "neutral"
      }]
    },
    body: { direction: "vertical", vertical_spacing: "4px", padding: "4px 12px 12px 12px", elements }
  };
}

export function buildAdminBackendEditCard(
  data: IMAdminBackendPanel,
  backendName: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const b = data.backends.find(x => x.name === backendName);
  if (!b) return buildAdminBackendCard(data, locale);

  const elements: unknown[] = [];

  // ── 接入源面板 ────────────────────────────────────────────────────
  for (let pi = 0; pi < b.providers.length; pi++) {
    const p = b.providers[pi]!;
    const keyDisplay = displayKey(p.apiKeyEnv);

    // ── 接入源内容（折叠区域） ───────────────────────
    const providerElements: unknown[] = [];

    // Delete button at top of panel body
    providerElements.push({
      tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [greyText(`${p.baseUrl ?? "-"}  ·  Key: ${keyDisplay} ${p.apiKeySet ? s.adminBackendKeyConfigured : s.adminBackendKeyNotConfigured}`)]
        },
        {
          tag: "column", width: "auto", vertical_align: "center",
          elements: [{
            tag: "button", text: { tag: "plain_text", content: s.adminBackendRemoveProvider },
            type: "danger", size: "small",
            icon: { tag: "standard_icon", token: "delete_outlined" },
            confirm: {
              title: { tag: "plain_text", content: s.adminBackendRemoveProviderConfirmTitle(p.name) },
              text: { tag: "plain_text", content: s.adminBackendRemoveProviderConfirmText }
            },
            behaviors: [{ type: "callback", value: { action: "admin_backend_remove_provider", backend: b.name, provider: p.name } }]
          }]
        }
      ]
    });

    // Model rows
    if (p.models.length > 0) {
      for (const m of p.models) {
        const statusTag = m.available === true
          ? s.adminBackendAvailable
          : m.available === false
            ? s.adminBackendUnavailable
            : s.adminBackendChecking;
        const timeStr = m.checkedAt
          ? new Date(m.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "—";

        providerElements.push({
          tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
          columns: [
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [{
                tag: "markdown",
                content: `\`${m.name}\`  ${statusTag}`,
                icon: { tag: "standard_icon", token: "cloud_outlined", color: "turquoise" }
              }]
            },
            { tag: "column", width: "auto", vertical_align: "center", elements: [greyText(timeStr)] },
            {
              tag: "column", width: "auto", vertical_align: "center",
              elements: [{
                tag: "button", text: { tag: "plain_text", content: s.adminBackendDelete },
                type: "danger", size: "small",
                icon: { tag: "standard_icon", token: "delete_outlined" },
                confirm: {
                  title: { tag: "plain_text", content: s.adminBackendDeleteModelConfirmTitle(m.name) },
                  text: { tag: "plain_text", content: s.adminBackendDeleteModelConfirmText }
                },
                behaviors: [{ type: "callback", value: { action: "admin_backend_remove_model", backend: b.name, provider: p.name, model: m.name } }]
              }]
            }
          ]
        });
      }
    } else {
      providerElements.push(greyText(s.adminBackendNoModelsConfigured));
    }

    // Wrap source as collapsible_panel
    elements.push({
      tag: "collapsible_panel",
      expanded: true,
      header: {
        title: { tag: "markdown", content: `**${p.name}**` },
        vertical_align: "center",
        icon: { tag: "standard_icon", token: "cloud_outlined", color: "turquoise", size: "16px 16px" },
        icon_position: "follow_text",
        icon_expanded_angle: 0
      },
      border: { color: "grey", corner_radius: "8px" },
      vertical_spacing: "4px",
      padding: "8px 12px 8px 12px",
      elements: providerElements
    });
  }

  // ── Action buttons: 2 per row ─────────────────────────────────────────
  const profileCount = (b.profiles ?? []).length;
  const hasPolicyFields = backendName === "codex" || backendName === "opencode";
  elements.push({ tag: "hr" });

  const navRow1Left = hasPolicyFields
    ? navEntry({ icon: "lock_outlined", title: s.adminBackendRunPolicy, subtitle: _policyPreview(b.policy ?? {}, backendName), action: "admin_backend_policy_edit", actionValue: { backend: b.name } })
    : null;
  const navRow1Right = navEntry({ icon: "add_outlined", title: s.adminBackendAddProvider, action: "admin_backend_add_provider_form", actionValue: { backend: b.name } });

  if (navRow1Left) {
    elements.push({
      tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
      columns: [
        { tag: "column", width: "weighted", weight: 1, vertical_align: "center", elements: [navRow1Left] },
        { tag: "column", width: "weighted", weight: 1, vertical_align: "center", elements: [navRow1Right] }
      ]
    });
  } else {
    elements.push(navRow1Right);
  }

  elements.push({
    tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
    columns: [
      {
        tag: "column", width: "weighted", weight: 1, vertical_align: "center",
        elements: [navEntry({ icon: "list-setting_outlined", title: s.adminBackendModelManage(profileCount), subtitle: undefined, action: "admin_backend_model_manage", actionValue: { backend: b.name } })]
      },
      {
        tag: "column", width: "weighted", weight: 1, vertical_align: "center",
        elements: [backPanel(s.adminBackendBack, "admin_panel_backend")]
      }
    ]
  });

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: b.name },
      subtitle: { tag: "plain_text", content: s.adminBackendEditSubtitle(b.name) },
      template: "turquoise",
      icon: { tag: "standard_icon", token: "setting_outlined", color: "turquoise" },
      text_tag_list: [{
        tag: "text_tag",
        text: { tag: "plain_text", content: s.adminBackendProviderCountOnly(b.providers.length) },
        color: "neutral"
      }]
    },
    body: { direction: "vertical", vertical_spacing: "4px", padding: "4px 12px 12px 12px", elements }
  };
}

// ── Sub-card: New model (profile = model + config) ──────────────────────────

export function buildAdminBackendModelCard(
  data: IMAdminBackendPanel,
  backendName: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const b = data.backends.find(x => x.name === backendName);
  if (!b) return buildAdminBackendCard(data, locale);

  const elements: unknown[] = [];

  // ── Existing profiles list ────────────────────────────────────────────
  const profiles = b.profiles ?? [];
  if (profiles.length > 0) {
    for (const profile of profiles) {
      const ex = (profile as any).extras ?? {};
      const extraParts: string[] = [];
      if (ex.model_reasoning_effort) extraParts.push(String(ex.model_reasoning_effort));
      if (ex.personality) extraParts.push(String(ex.personality));
      if (ex.thinking_budget_tokens) extraParts.push(`think:${ex.thinking_budget_tokens}`);
      if (ex.context_limit) extraParts.push(`ctx:${ex.context_limit}`);
      if (ex.output_limit) extraParts.push(`out:${ex.output_limit}`);
      if (ex.modalities) {
        const m = ex.modalities as { input?: string[]; output?: string[] };
        if (m.input?.length) extraParts.push(`in:[${m.input.join(",")}]`);
        if (m.output?.length) extraParts.push(`out:[${m.output.join(",")}]`);
      }
      const extraStr = extraParts.length > 0 ? `  ·  ${extraParts.join(" · ")}` : "";
      elements.push({
        tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
        columns: [
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [{
              tag: "markdown",
              content: `\`${profile.name}\`  →  ${profile.model}${extraStr}`,
              icon: { tag: "standard_icon", token: "app_outlined", color: "blue" }
            }]
          },
          {
            tag: "column", width: "auto", vertical_align: "center",
            elements: [{
              tag: "button", text: { tag: "plain_text", content: s.adminBackendDelete },
              type: "danger", size: "small",
              icon: { tag: "standard_icon", token: "delete_outlined" },
              confirm: {
                title: { tag: "plain_text", content: s.adminBackendDeleteModelConfirmTitle(profile.name) },
                text: { tag: "plain_text", content: s.adminBackendDeleteModelConfirmText }
              },
              behaviors: [{ type: "callback", value: { action: "admin_backend_remove_profile", backend: b.name, profile: profile.name } }]
            }]
          }
        ]
      });
    }
  }

  // ── New model form ────────────────────────────────────────────────────
  elements.push({ tag: "hr" });
  const pfId = sanitizeElementId(`pf_${backendName}`);
  const pfFields: unknown[] = [];

  // Row 1: 接入源下拉 + 模型名输入
  const providerOptions = b.providers.map(p => ({
    text: { tag: "plain_text", content: p.name },
    value: p.name
  }));
  pfFields.push(greyText(s.adminBackendProviderLabel));
  pfFields.push({
    tag: "select_static", name: "profile_provider",
    placeholder: { tag: "plain_text", content: s.adminBackendChooseProvider },
    ...(providerOptions.length > 0 ? { initial_option: providerOptions[0]!.value } : {}),
    options: providerOptions.length > 0 ? providerOptions : [{ text: { tag: "plain_text", content: s.adminBackendNoProvider }, value: "" }]
  });
  pfFields.push(greyText(s.adminBackendModelName));
  pfFields.push({
    tag: "input", name: "profile_model",
    placeholder: { tag: "plain_text", content: s.adminBackendModelPlaceholder }, default_value: ""
  });

  // Row 2: Profile name
  pfFields.push(greyText(s.adminBackendProfileName));
  pfFields.push({
    tag: "input", name: "profile_name",
    placeholder: { tag: "plain_text", content: s.adminBackendProfilePlaceholder }, default_value: ""
  });

  // Row 3+: Backend-specific extras (each with label)
  if (backendName === "codex") {
    pfFields.push(greyText(s.adminBackendReasoningEffort));
    pfFields.push({
      tag: "select_static", name: "model_reasoning_effort",
      placeholder: { tag: "plain_text", content: s.adminBackendChooseReasoning },
      initial_option: "medium",
      options: [
        { text: { tag: "plain_text", content: s.adminBackendReasoningHigh }, value: "high" },
        { text: { tag: "plain_text", content: s.adminBackendReasoningMedium }, value: "medium" },
        { text: { tag: "plain_text", content: s.adminBackendReasoningLow }, value: "low" }
      ]
    });
    pfFields.push(greyText(s.adminBackendPersonality));
    pfFields.push({
      tag: "select_static", name: "personality",
      placeholder: { tag: "plain_text", content: s.adminBackendChoosePersonality },
      initial_option: "pragmatic",
      options: [
        { text: { tag: "plain_text", content: s.adminBackendPersonalityFriendly }, value: "friendly" },
        { text: { tag: "plain_text", content: s.adminBackendPersonalityPragmatic }, value: "pragmatic" },
        { text: { tag: "plain_text", content: s.adminBackendPersonalityNone }, value: "none" }
      ]
    });
  } else if (backendName === "opencode") {
    pfFields.push(greyText(s.adminBackendThinkingBudget));
    pfFields.push({
      tag: "input", name: "thinking_budget_tokens",
      placeholder: { tag: "plain_text", content: s.adminBackendThinkingBudgetPlaceholder }, default_value: "8192"
    });
    pfFields.push(greyText(s.adminBackendContextLimit));
    pfFields.push({
      tag: "input", name: "context_limit",
      placeholder: { tag: "plain_text", content: s.adminBackendContextLimitPlaceholder }, default_value: ""
    });
    pfFields.push(greyText(s.adminBackendOutputLimit));
    pfFields.push({
      tag: "input", name: "output_limit",
      placeholder: { tag: "plain_text", content: s.adminBackendOutputLimitPlaceholder }, default_value: ""
    });
    const modalityOpts = ["text", "audio", "image", "video", "pdf"].map(v => ({
      text: { tag: "plain_text" as const, content: v }, value: v
    }));
    pfFields.push(greyText(s.adminBackendInputModalities));
    pfFields.push({
      tag: "multi_select_static", name: "modalities_input",
      placeholder: { tag: "plain_text", content: s.adminBackendChooseInputModalities },
      selected_values: ["text"],
      options: modalityOpts
    });
    pfFields.push(greyText(s.adminBackendOutputModalities));
    pfFields.push({
      tag: "multi_select_static", name: "modalities_output",
      placeholder: { tag: "plain_text", content: s.adminBackendChooseOutputModalities },
      selected_values: ["text"],
      options: modalityOpts
    });
  }

  // Add submit button to the form
  pfFields.push({
    tag: "button", text: { tag: "plain_text", content: s.adminBackendNewModel },
    type: "primary", width: "fill",
    icon: { tag: "standard_icon", token: "add_outlined" },
    form_action_type: "submit", name: "pf_submit",
    behaviors: [{ type: "callback", value: { action: "admin_backend_add_profile", backend: b.name } }]
  });

  elements.push({
    tag: "form", name: pfId, element_id: pfId,
    elements: pfFields
  });

  // ── Back button — same row style ──────────────────────────────────────
  elements.push({ tag: "hr" });
  elements.push(backPanel(s.adminBackendBackToConfig(b.name), "admin_backend_edit", { backend: b.name }));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminBackendModelCardTitle(b.name) },
      subtitle: { tag: "plain_text", content: s.adminBackendModelCardSubtitle },
      template: "blue",
      icon: { tag: "standard_icon", token: "list-setting_outlined", color: "blue" },
      text_tag_list: [{
        tag: "text_tag",
        text: { tag: "plain_text", content: s.adminBackendProfileCount(profiles.length) },
        color: "neutral"
      }]
    },
    body: { direction: "vertical", vertical_spacing: "4px", padding: "4px 12px 12px 12px", elements }
  };
}

/** Helper: generate a short policy preview string for navigation button */
function _policyPreview(policy: Record<string, string>, backendName: string): string {
  if (backendName === "codex") {
    const ap = policy.approval_policy ?? "—";
    const sb = policy.sandbox_mode ?? "—";
    return `${ap} · ${sb}`;
  }
  if (backendName === "opencode") {
    return `question=${policy.permission_question ?? "—"}`;
  }
  return "—";
}

// ── Sub-card: Policy configuration ──────────────────────────────────────────

export function buildAdminBackendPolicyCard(
  data: IMAdminBackendPanel,
  backendName: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const b = data.backends.find(x => x.name === backendName);
  if (!b) return buildAdminBackendCard(data, locale);

  const policy = b.policy ?? {};
  const policyFields: Array<{ field: string; label: string; options: Array<{ value: string; label: string }> }> = [];

  if (backendName === "codex") {
    policyFields.push({
      field: "approval_policy", label: s.adminBackendPolicyApproval,
      options: [
        { value: "on-request", label: s.adminBackendPolicyApprovalOnRequest },
        { value: "never", label: s.adminBackendPolicyApprovalNever },
        { value: "untrusted", label: s.adminBackendPolicyApprovalUntrusted },
      ],
    });
    policyFields.push({
      field: "sandbox_mode", label: s.adminBackendPolicySandbox,
      options: [
        { value: "workspace-write", label: s.adminBackendPolicySandboxWorkspaceWrite },
        { value: "read-only", label: s.adminBackendPolicySandboxReadOnly },
        { value: "danger-full-access", label: s.adminBackendPolicySandboxFullAccess },
      ],
    });
  } else if (backendName === "opencode") {
    policyFields.push({
      field: "permission_question", label: s.adminBackendPolicyQuestion,
      options: [
        { value: "allow", label: s.adminBackendPolicyQuestionAllow },
        { value: "ask", label: s.adminBackendPolicyQuestionAsk },
        { value: "deny", label: s.adminBackendPolicyQuestionDeny },
      ],
    });
  }

  const elements: unknown[] = [];
  const pfId = sanitizeElementId("pf0");
  const formElements: unknown[] = [];

  for (const pf of policyFields) {
    formElements.push({
      tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 1, vertical_align: "center",
          elements: [greyText(pf.label)]
        },
        {
          tag: "column", width: "weighted", weight: 2, vertical_align: "center",
          elements: [{
            tag: "select_static", name: pf.field, placeholder: { tag: "plain_text", content: pf.label },
            initial_option: policy[pf.field] ?? pf.options[0]!.value,
            options: pf.options.map(o => ({ text: { tag: "plain_text", content: o.label }, value: o.value }))
          }]
        }
      ]
    });
  }
  formElements.push({
    tag: "button", text: { tag: "plain_text", content: s.adminBackendSavePolicy },
    type: "primary", size: "small", width: "fill",
    icon: { tag: "standard_icon", token: "done_outlined" },
    form_action_type: "submit", name: "ps",
    behaviors: [{ type: "callback", value: { action: "admin_backend_policy_save", backend: b.name } }]
  });

  elements.push({ tag: "form", name: pfId, element_id: pfId, elements: formElements });

  // Back button
  elements.push({ tag: "hr" });
  elements.push(backPanel(s.adminBackendBackToBackend(b.name), "admin_backend_edit", { backend: b.name }));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminBackendPolicyTitle },
      subtitle: { tag: "plain_text", content: s.adminBackendPolicySubtitle(b.name) },
      template: "turquoise",
      icon: { tag: "standard_icon", token: "lock_outlined", color: "turquoise" }
    },
    body: { direction: "vertical", vertical_spacing: "8px", padding: "8px 12px 12px 12px", elements }
  };
}

// ── Sub-card: Add Source ──────────────────────────────────────────────────

export function buildAdminBackendAddProviderCard(
  data: IMAdminBackendPanel,
  backendName: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const b = data.backends.find(x => x.name === backendName);
  if (!b) return buildAdminBackendCard(data, locale);

  const afId = sanitizeElementId("af0");
  const elements: unknown[] = [];

  elements.push({
    tag: "form", name: afId, element_id: afId,
    elements: [
      {
        tag: "markdown", content: `**${s.adminBackendProviderName}**`,
        icon: { tag: "standard_icon", token: "edit_outlined", color: "turquoise" }
      },
      { tag: "input", name: "pn", placeholder: { tag: "plain_text", content: s.adminBackendProviderNamePlaceholder }, default_value: "" },
      {
        tag: "markdown", content: `**${s.adminBackendBaseUrl}**`,
        icon: { tag: "standard_icon", token: "sharelink_outlined", color: "turquoise" }
      },
      { tag: "input", name: "pu", placeholder: { tag: "plain_text", content: s.adminBackendBaseUrlPlaceholder }, default_value: "" },
      {
        tag: "markdown", content: `**${s.adminBackendApiKey(backendName === "codex")}**`,
        icon: { tag: "standard_icon", token: "lock_outlined", color: "turquoise" }
      },
      { tag: "input", name: "pk", placeholder: { tag: "plain_text", content: s.adminBackendApiKeyPlaceholder(backendName === "codex") }, default_value: "" },
      {
        tag: "button", text: { tag: "plain_text", content: s.adminBackendAddProviderSubmit },
        type: "primary", width: "fill",
        icon: { tag: "standard_icon", token: "add_outlined" },
        form_action_type: "submit", name: "sa",
        behaviors: [{ type: "callback", value: { action: "admin_backend_add_provider", backend: b.name } }]
      }
    ]
  });

  // Back button
  elements.push({ tag: "hr" });
  elements.push(backPanel(s.adminBackendBackToBackend(b.name), "admin_backend_edit", { backend: b.name }));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.adminBackendAddProviderTitle },
      subtitle: { tag: "plain_text", content: s.adminBackendAddProviderSubtitle(b.name) },
      template: "turquoise",
      icon: { tag: "standard_icon", token: "add_outlined", color: "turquoise" }
    },
    body: { direction: "vertical", vertical_spacing: "8px", padding: "8px 12px 12px 12px", elements }
  };
}

// ── Turn History ────────────────────────────────────────────────────────────

export interface TurnHistoryEntry {
  chatId: string;
  turnId: string;
  threadName?: string;
  turnNumber?: number;
  promptSummary?: string;
  message?: string;
  backendName?: string;
  modelName?: string;
  fileCount: number;
  tokenUsage?: { input: number; output: number; total?: number };
  actionTaken?: string;
}

function turnHistoryStatusText(actionTaken?: string): string {
  const s = getFeishuCardBuilderStrings(DEFAULT_APP_LOCALE);
  return actionTaken === "accepted" ? s.turnHistoryAccepted
    : actionTaken === "reverted" ? s.turnHistoryReverted
      : actionTaken === "interrupted" ? s.turnHistoryInterrupted
        : s.turnHistoryCompleted;
}

export function buildTurnHistoryCard(
  turns: TurnHistoryEntry[],
  ownerId?: string,
  fromHelp?: boolean,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const elements: unknown[] = [];

  if (turns.length === 0) {
    elements.push(greyText(s.turnHistoryEmpty));
  } else {
    for (const t of turns) {
      const rawSummary = t.promptSummary
        ? t.promptSummary
        : t.message
          ? t.message.split("\n")[0]!.slice(0, 30)
          : s.turnHistoryDefaultSummary;
      const summary = rawSummary.slice(0, 20);
      const meta = [
        t.turnNumber ? `#${t.turnNumber}` : null,
        t.threadName || null,
        t.backendName || null,
        t.fileCount > 0 ? `${t.fileCount} files` : null,
      ].filter(Boolean).join(" · ");
      const statusLabel = t.actionTaken === "accepted" ? "✅"
        : t.actionTaken === "reverted" ? "↩️"
          : t.actionTaken === "interrupted" ? "⛔"
            : "✅";

      elements.push({
        tag: "interactive_container",
        width: "fill", height: "auto",
        has_border: true, border_color: "grey", corner_radius: "8px",
        padding: "10px 12px 10px 12px",
        margin: "2px 0",
        behaviors: [{ type: "callback", value: { action: "view_turn_detail", chatId: t.chatId, turnId: t.turnId, ownerId } }],
        elements: [{
          tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
          columns: [
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [{
                tag: "markdown",
                content: `**${statusLabel} #${t.turnNumber ?? "?"}** ${summary}`,
              }]
            },
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [greyText(meta || "—")]
            }
          ]
        }]
      });
    }
  }

  // Back button
  if (fromHelp) {
    elements.push({ tag: "hr" });
    elements.push(backPanel(s.turnHistoryBack, "help_home"));
  }

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.turnHistoryTitle },
      subtitle: { tag: "plain_text", content: s.turnHistorySubtitle(turns.length) },
      template: "turquoise",
      icon: { tag: "standard_icon", token: "history_outlined", color: "turquoise" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "4px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

// ── Per-File Merge Review Card ──────────────────────────────────────────────

export function buildFileReviewCard(review: IMFileMergeReview, locale: AppLocale = DEFAULT_APP_LOCALE): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const DECISION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
    accept: { label: s.mergeDecisionAccept, icon: "check_outlined", color: "green" },
    keep_main: { label: s.mergeDecisionKeepMain, icon: "undo_outlined", color: "blue" },
    use_branch: { label: s.mergeDecisionUseBranch, icon: "switch_outlined", color: "purple" },
    skip: { label: s.mergeDecisionSkip, icon: "close_outlined", color: "grey" },
  };
  const STATUS_LABELS: Record<string, string> = {
    auto_merged: s.mergeStatusAutoMerged,
    agent_resolved: s.mergeStatusAgentResolved,
    agent_pending: s.mergeStatusAgentPending,
    conflict: s.mergeStatusConflict,
    added: s.mergeStatusAdded,
    deleted: s.mergeStatusDeleted,
  };
  const { branchName, baseBranch, fileIndex, totalFiles, file, availableDecisions, progress } = review;
  const elements: unknown[] = [];

  // Status tag
  elements.push({
    tag: "markdown",
    content: `${STATUS_LABELS[file.status] ?? file.status} · \`${file.path}\``,
    icon: { tag: "standard_icon", token: "code_outlined", color: file.status === "conflict" ? "red" : "turquoise" }
  });

  // Diff (collapsible)
  if (file.diff) {
    const diffPreview = file.diff.length > 3000 ? file.diff.slice(0, 3000) + s.mergeDiffTruncated : file.diff;
    elements.push({
      tag: "collapsible_panel",
      expanded: totalFiles <= 3,
      header: {
        title: { tag: "markdown", content: s.mergeReviewViewDiff },
        icon: { tag: "standard_icon", token: "code_outlined", color: "grey", size: "16px 16px" },
        icon_position: "follow_text", icon_expanded_angle: -180
      },
      vertical_spacing: "2px",
      background_color: "grey",
      elements: [{ tag: "markdown", content: "```diff\n" + diffPreview + "\n```" }]
    });
  }

  // Decision buttons (accept / keep_main / use_branch — outside the form_container)
  elements.push({ tag: "hr" });
  const buttonCols: unknown[] = [];
  for (const d of availableDecisions) {
    const meta = DECISION_LABELS[d];
    if (!meta) continue;
    buttonCols.push({
      tag: "column", width: "weighted", weight: 1, vertical_align: "center",
      elements: [{
        tag: "button",
        text: { tag: "plain_text", content: meta.label },
        type: d === "accept" ? "primary" : "default",
        size: "small",
        icon: { tag: "standard_icon", token: meta.icon },
        behaviors: [{
          type: "callback", value: {
            action: `merge_${d}`, branchName, filePath: file.path
          }
        }]
      }]
    });
  }
  elements.push({ tag: "column_set", flex_mode: "bisect", columns: buttonCols });

  // Reject form (agent_resolved / conflict files: input + reject button in form_container)
  if (file.status === "agent_resolved" || file.status === "conflict") {
    elements.push(greyText(s.mergeReviewRejectHint));
    const formId = sanitizeElementId(`merge_reject_${branchName}_${file.path}`);
    elements.push({
      tag: "form",
      name: formId,
      element_id: formId,
      elements: [
        {
          tag: "input",
          label: { tag: "plain_text", content: s.mergeReviewFeedbackLabel },
          placeholder: { tag: "plain_text", content: s.mergeReviewFeedbackPlaceholder },
          max_length: 500,
          name: "merge_feedback"
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: s.mergeReviewRejectAction },
          type: "danger",
          size: "small",
          icon: { tag: "standard_icon", token: "close_outlined" },
          form_action_type: "submit",
          name: "merge_reject_submit",
          behaviors: [{ type: "callback", value: { action: "merge_reject", branchName, filePath: file.path } }]
        }
      ]
    });
  }

  // Accept all button
  elements.push({
    tag: "interactive_container",
    width: "fill", height: "auto",
    has_border: true, border_color: "grey", corner_radius: "8px",
    padding: "8px 12px 8px 12px",
    behaviors: [{ type: "callback", value: { action: "merge_accept_all", branchName } }],
    elements: [{
      tag: "markdown", content: s.mergeReviewAcceptAll(progress.remaining),
      icon: { tag: "standard_icon", token: "check-double_outlined", color: "green" }
    }]
  });

  // Progress bar
  const total = progress.accepted + progress.rejected + progress.remaining;
  const pctDone = total > 0 ? Math.round(((progress.accepted + progress.rejected) / total) * 100) : 0;
  elements.push(greyText(s.mergeReviewProgress(progress.accepted, progress.rejected, progress.remaining, pctDone)));

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.mergeReviewTitle(fileIndex + 1, totalFiles) },
      subtitle: { tag: "plain_text", content: `${branchName} → ${baseBranch}` },
      template: file.status === "conflict" ? "red" : file.status === "agent_resolved" ? "purple" : file.status === "agent_pending" ? "orange" : "turquoise",
      icon: { tag: "standard_icon", token: "mergecells_outlined", color: file.status === "conflict" ? "red" : file.status === "agent_resolved" ? "purple" : file.status === "agent_pending" ? "orange" : "turquoise" },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: STATUS_LABELS[file.status] ?? file.status }, color: file.status === "conflict" ? "red" : file.status === "agent_pending" ? "orange" : "green" }
      ]
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}

export function buildMergeSummaryCard(summary: IMMergeSummary, locale: AppLocale = DEFAULT_APP_LOCALE): Record<string, unknown> {
  const s = getFeishuCardBuilderStrings(locale);
  const { branchName, baseBranch, files, hasPartialMerge } = summary;
  const elements: unknown[] = [];

  // File list with decisions
  const accepted = files.filter(f => f.decision === "accept");
  const others = files.filter(f => f.decision !== "accept");

  if (accepted.length > 0) {
    const list = accepted.map(f => `✅ \`${f.path}\``).join("\n");
    elements.push({ tag: "markdown", content: s.mergeSummaryAccepted(accepted.length, list) });
  }
  if (others.length > 0) {
    const list = others.map(f => {
      const icon = f.decision === "keep_main" ? "🔄" : f.decision === "use_branch" ? "🔀" : "⏭️";
      const label = f.decision === "keep_main" ? s.mergeDecisionKeepMainLabel : f.decision === "use_branch" ? s.mergeDecisionUseBranchLabel : s.mergeDecisionSkipLabel;
      return `${icon} \`${f.path}\` (${label})`;
    }).join("\n");
    elements.push({ tag: "markdown", content: s.mergeSummaryOthers(others.length, list) });
  }

  if (hasPartialMerge) {
    elements.push(greyText(s.mergeSummaryPartialWarning));
  }

  // Action buttons
  elements.push({ tag: "hr" });
  elements.push({
    tag: "column_set",
    flex_mode: "bisect",
    columns: [
      {
        tag: "column", width: "weighted", weight: 1, vertical_align: "center",
        elements: [{
          tag: "button",
          text: { tag: "plain_text", content: s.mergeSummaryCommit },
          type: "primary",
          behaviors: [{ type: "callback", value: { action: "merge_commit", branchName } }]
        }]
      },
      {
        tag: "column", width: "weighted", weight: 1, vertical_align: "center",
        elements: [{
          tag: "button",
          text: { tag: "plain_text", content: s.mergeSummaryCancel },
          type: "danger",
          behaviors: [{ type: "callback", value: { action: "merge_cancel", branchName } }]
        }]
      }
    ]
  });

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.mergeSummaryTitle },
      subtitle: { tag: "plain_text", content: s.mergeSummarySubtitle(branchName, baseBranch, accepted.length, files.length) },
      template: hasPartialMerge ? "orange" : "green",
      icon: { tag: "standard_icon", token: "mergecells_outlined", color: hasPartialMerge ? "orange" : "green" }
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements
    }
  };
}
