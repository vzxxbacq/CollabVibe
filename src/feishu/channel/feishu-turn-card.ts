/**
 * @module packages/channel-feishu/src/feishu-turn-card
 *
 * TurnCardManager — encapsulates all streaming turn card state, rendering, and lifecycle.
 *
 * Each turn gets its own `TurnCardState` with per-turn `backendName`/`modelName`,
 * eliminating the cross-user state leak that existed when these were singleton fields.
 *
 * Responsibilities:
 * - Per-turn card state management (create / get / cleanup)
 * - Card JSON rendering (renderCard)
 * - Throttled card updates (scheduleCardUpdate / flushCardUpdate)
 * - Card creation dedup (ensureCard)
 * - Card state persistence + recovery (for server restart)
 * - Stream aggregation delegation
 *
 * Extracted from FeishuOutputAdapter for better cohesion.
 */
import { StreamAggregator } from "../../common/stream-aggregator";

import { createLogger } from "../../logging";
import { DEFAULT_APP_LOCALE, type AppLocale } from "../../common/app-locale";
import type { IMTurnSummary } from "../../../services/index";

import type { TurnCardReader } from "../../common/types";

import { getFeishuTurnCardStrings } from "./feishu-turn-card.strings";

// ── Types ────────────────────────────────────────────────────────────────────

interface FeishuFileChangeState {
  filesChanged: string[];
  diffSummary: string;
  stats?: { additions: number; deletions: number };
  /** Pre-parsed per-file summaries (provided by L2, may be absent for old data) */
  diffFiles?: Array<{ file: string; status: "new" | "modified" | "deleted"; additions: number; deletions: number }>;
  /** Pre-parsed per-file diff segments with content (provided by L2, may be absent for old data) */
  diffSegments?: Array<{ file: string; status: "new" | "modified" | "deleted"; additions: number; deletions: number; content: string }>;
}

interface FeishuToolOutput {
  command: string;
  output: string;
}

interface FeishuPlanState {
  explanation?: string;
  items: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
}

interface HistoricalToolState {
  label: string;
  tool: string;
  callId?: string;
  status: "running" | "completed" | "failed";
  targetFile?: string;
}

interface HistoricalTurnCardInput {
  chatId: string;
  turnId: string;
  threadName?: string;
  turnNumber?: number;
  backendName?: string;
  modelName?: string;
  thinking?: string;
  message?: string;
  tools?: HistoricalToolState[];
  fileChanges: FeishuFileChangeState[];
  toolOutputs?: Array<{ callId: string; command: string; output: string }>;
  planState?: FeishuPlanState;
  tokenUsage?: { input: number; output: number; total?: number };
  promptSummary?: string;
  agentNote?: string;
  actionTaken?: "accepted" | "reverted" | "interrupting" | "interrupted";
  interruptedBy?: string;
  interruptRequestedAt?: string;
  interruptedAt?: string;
  turnMode?: "plan";
}

export interface TurnCardState {
  chatId: string;
  turnId: string;
  threadName?: string;
  turnNumber?: number;
  /** Per-turn backend name (e.g. "codex", "opencode") — NOT shared across turns */
  backendName?: string;
  /** Per-turn model name (e.g. "gpt-5.3-codex") — NOT shared across turns */
  modelName?: string;
  thinking: string;
  message: string;
  tools: string[];
  fileChanges: FeishuFileChangeState[];
  toolOutputs: Map<string, FeishuToolOutput>;
  planState?: FeishuPlanState;
  /** Streaming-only draft plan text from plan_delta; never persisted or used by final/history cards. */
  planDraft?: string;
  callIdToLabel: Map<string, string>;
  footer: string;
  tokenUsage?: { input: number; output: number; total?: number };
  promptSummary?: string;
  agentNote?: string;
  actionTaken?: "accepted" | "reverted" | "interrupting" | "interrupted";
  interruptedBy?: string;
  interruptRequestedAt?: string;
  interruptedAt?: string;
  /** Turn mode — "plan" for plan mode, undefined for default agent mode */
  turnMode?: "plan";
  /** Whether this turn belongs to a merge-resolver thread (L2 pre-computed) */
  isMergeResolver?: boolean;
}

export interface TurnCardMessageClient {
  sendMessage(input: { chatId: string; text?: string }): Promise<string>;
  sendInteractiveCard(chatId: string, card: Record<string, unknown>): Promise<string>;
  updateInteractiveCard(cardToken: string, card: Record<string, unknown>): Promise<void>;
  pinMessage?(messageId: string): Promise<void>;
  createCardEntity?(card: Record<string, unknown>): Promise<string>;
  sendCardEntity?(chatId: string, cardId: string): Promise<string>;
  updateCardSettings?(cardId: string, settings: Record<string, unknown>, sequence: number): Promise<void>;
  streamCardElement?(cardId: string, elementId: string, content: string, sequence: number): Promise<void>;
  updateCardElement?(cardId: string, elementId: string, element: Record<string, unknown>, sequence: number): Promise<void>;
}

interface IMProgressEvent {
  kind: "progress";
  turnId: string;
  phase: "begin" | "end";
  tool: string;
  label: string;
  callId?: string;
  status?: "success" | "failed";
  summary?: string;
  targetFile?: string;
  agentId?: string;
}

interface IMToolOutputChunk {
  turnId: string;
  callId: string;
  delta: string;
}

interface IMPlanUpdate {
  kind: "plan_update";
  turnId: string;
  explanation?: string;
  plan: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
}

interface InterruptActionMeta {
  actorName?: string;
  requestedAt?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function keyOf(chatId: string, turnId: string): string {
  return `${chatId}:${turnId}`;
}

function progressIcon(event: IMProgressEvent, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  const s = getFeishuTurnCardStrings(locale);
  if (event.phase === "begin") return s.running;
  if (event.status === "failed") return s.failed;
  return s.completed;
}

/** div + plain_text with grey notation */
function greyText(content: string): Record<string, unknown> {
  return {
    tag: "div",
    text: { tag: "plain_text", content, text_size: "notation", text_color: "grey" }
  };
}

function toTokenText(tokenUsage?: { input: number; output: number; total?: number }): string {
  if (!tokenUsage) return "-";
  return String(tokenUsage.total ?? (tokenUsage.input + tokenUsage.output));
}

function formatThreadNameLabel(threadName?: string, locale: AppLocale = DEFAULT_APP_LOCALE): string | null {
  const normalized = threadName?.trim();
  const s = getFeishuTurnCardStrings(locale);
  return normalized ? s.threadNameLabel(normalized) : null;
}

function historicalToolLine(tool: HistoricalToolState, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  const s = getFeishuTurnCardStrings(locale);
  const icon = tool.status === "failed"
    ? s.failed
    : tool.status === "completed"
      ? s.completed
      : s.running;
  return `${icon} ${tool.label}`;
}

function formatEventTime(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function truncateForStreaming(text: string, maxChars = 200): string {
  const normalized = text.trim();
  if (!normalized) return "";
  return normalized.length > maxChars ? `…${normalized.slice(-maxChars)}` : normalized;
}

function quoteMarkdown(title: string, content: string, maxChars = 200): string {
  const truncated = truncateForStreaming(content, maxChars);
  if (!truncated) return `> **${title}**\n> ...`;
  return `> **${title}**\n> ${truncated.replace(/\n/g, "\n> ")}`;
}

function renderPlanMarkdown(planState: FeishuPlanState, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  const s = getFeishuTurnCardStrings(locale);
  const lines: string[] = [];
  if (planState.explanation?.trim()) {
    lines.push(planState.explanation.trim());
  }
  if (planState.explanation?.trim() && planState.items.length > 0) {
    lines.push("");
  }
  for (const [index, item] of planState.items.entries()) {
    const statusLabel = item.status === "completed"
      ? s.planCompleted
      : item.status === "in_progress"
        ? s.planInProgress
        : s.planPending;
    lines.push(`${index + 1}. ${statusLabel} ${item.step}`);
  }
  return lines.join("\n") || s.planUpdated;
}

const STREAM_MSG_ELEMENT_ID = "turn_msg";
const STREAM_THINK_ELEMENT_ID = "turn_think";
const STREAM_PROGRESS_ELEMENT_ID = "turn_prog";
const STREAM_TOOLS_ELEMENT_ID = "turn_tools";
const STREAM_FOOTER_ELEMENT_ID = "turn_foot";
const STREAM_ACTIONS_ELEMENT_ID = "turn_act";

interface NativeStreamSession {
  cardId: string;
  messageId: string;
  sequence: number;
  streamingActive: boolean;
  pending: Promise<void>;
  lastSent: Map<string, string>;
  degraded: boolean;
}

/** 中英文停词表 — 过滤低信息量词汇 */
const STOP_WORDS = new Set([
  // 中文
  "的", "了", "是", "在", "我", "你", "他", "她", "它", "们", "这", "那", "和", "与",
  "也", "都", "就", "会", "可以", "不", "有", "被", "把", "对", "到", "从", "为", "已",
  "已经", "将", "等", "个", "中", "上", "下", "做", "一个", "进行", "使用", "通过",
  // 英文
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "shall", "can", "need", "must",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their",
  "this", "that", "these", "those", "what", "which", "who", "whom",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "as", "into",
  "about", "between", "through", "during", "before", "after",
  "and", "but", "or", "not", "no", "so", "if", "then", "than", "too", "very",
  "just", "also", "here", "there", "now", "all", "each", "every", "both",
]);

/** 从 agent 回复中提取关键词作为 header title */
function extractKeywords(msg: string | undefined, maxKeywords = 5, maxLen = 30): string {
  if (!msg || msg.trim().length === 0) return "";
  // 1. 取第一个非空行
  const firstLine = msg.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  // 2. 去除 markdown 格式字符
  const cleaned = firstLine
    .replace(/[#*`>~\[\]()!|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // 3. 分词并过滤停词
  const tokens = cleaned.split(/[\s,;:，；：、]+/).filter((t) => {
    if (t.length === 0) return false;
    if (STOP_WORDS.has(t.toLowerCase())) return false;
    if (/^\d+$/.test(t)) return false; // 纯数字
    return true;
  });
  if (tokens.length === 0) return cleaned.slice(0, maxLen) || "";
  // 4. 取前 N 个关键词，限制总长度
  const selected: string[] = [];
  let totalLen = 0;
  for (const t of tokens) {
    if (selected.length >= maxKeywords) break;
    if (totalLen + t.length > maxLen) break;
    selected.push(t);
    totalLen += t.length + 1; // +1 for space
  }
  return selected.join(" ");
}

// ── TurnCardManager ──────────────────────────────────────────────────────────

export class TurnCardManager {
  private readonly cardTokenByTurn = new Map<string, string>();
  private readonly cardState = new Map<string, TurnCardState>();
  private readonly nativeStreamSessions = new Map<string, NativeStreamSession>();

  /** Per-project-thread turn counter for human-readable turn numbering (keyed by bound chatId:threadName) */
  private readonly turnCounter = new Map<string, number>();

  private readonly streamAggregator = new StreamAggregator({
    windowMs: 500,
    maxWaitMs: 3000,
    maxChars: 2000
  });

  private readonly cardUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cardDirty = new Set<string>();
  private readonly cardThrottleMs: number;


  private readonly turnCardReader?: TurnCardReader;
  private readonly locale: AppLocale;
  private readonly log = createLogger("card");

  /** 外部回调：turn 完成时通知 server 层持久化摘要 */
  onTurnComplete?: (chatId: string, summary: IMTurnSummary) => void;

  private cardCreatePending = new Map<string, Promise<string>>();

  constructor(
    private readonly client: TurnCardMessageClient,
    options?: {
      cardThrottleMs?: number;
      locale?: AppLocale;
      turnCardReader?: TurnCardReader;
    }
  ) {
    this.locale = options?.locale ?? DEFAULT_APP_LOCALE;
    this.cardThrottleMs = options?.cardThrottleMs ?? 5000;
    this.turnCardReader = options?.turnCardReader;
  }

  // ── State Management ─────────────────────────────────────────────────────

  getOrCreateState(chatId: string, turnId: string): TurnCardState {
    const key = keyOf(chatId, turnId);
    const existing = this.cardState.get(key);
    if (existing) return existing;
    const initial: TurnCardState = {
      chatId, turnId,
      turnNumber: undefined,
      thinking: "",
      message: "",
      tools: [],
      fileChanges: [],
      toolOutputs: new Map(),
      planState: undefined,
      planDraft: undefined,
      callIdToLabel: new Map(),
      footer: ""
    };
    this.cardState.set(key, initial);
    return initial;
  }

  private isInterruptPending(state: TurnCardState | undefined): boolean {
    return state?.actionTaken === "interrupting";
  }

  private isInterrupted(state: TurnCardState | undefined): boolean {
    return state?.actionTaken === "interrupted";
  }

  private isTerminalInterrupted(state: TurnCardState | undefined): boolean {
    return state?.actionTaken === "interrupting" || state?.actionTaken === "interrupted";
  }

  private nextTurnNumber(chatId: string, threadName: string): number {
    const projectThreadCounterKey = `${chatId}:${threadName}`;
    const inMemoryCurrent = this.turnCounter.get(projectThreadCounterKey);
    if (inMemoryCurrent !== undefined) {
      const next = inMemoryCurrent + 1;
      this.turnCounter.set(projectThreadCounterKey, next);
      return next;
    }

    const persistedCurrent = 0; // turnNumber now sourced from L2 via setCardThreadName
    const seed = typeof persistedCurrent === "number" && Number.isFinite(persistedCurrent) ? persistedCurrent : 0;
    const next = seed + 1;
    this.turnCounter.set(projectThreadCounterKey, next);
    return next;
  }

  /** Set thread name on card state early (before completeTurn). */
  setCardThreadName(chatId: string, turnId: string, threadName: string, turnNumber?: number): void {
    const state = this.getOrCreateState(chatId, turnId);
    state.threadName = threadName;
    if (turnNumber !== undefined) {
      state.turnNumber = turnNumber;
    } else if (state.turnNumber === undefined) {
      state.turnNumber = this.nextTurnNumber(chatId, threadName);
    }
  }

  /** Set per-turn backend/model info — stored on the turn's own state, not shared. */
  setCardBackendInfo(chatId: string, turnId: string, backendName: string, modelName: string): void {
    const state = this.getOrCreateState(chatId, turnId);
    state.backendName = backendName;
    state.modelName = modelName;
  }

  /** Set per-turn mode (plan vs default agent). */
  setCardTurnMode(chatId: string, turnId: string, mode: "plan"): void {
    const state = this.getOrCreateState(chatId, turnId);
    state.turnMode = mode;
  }

  /** Set per-turn prompt summary (extracted from user’s prompt text). */
  setCardPromptSummary(chatId: string, turnId: string, promptText: string): void {
    const state = this.getOrCreateState(chatId, turnId);
    state.promptSummary = extractKeywords(promptText);
  }

  // ── Card Lifecycle ───────────────────────────────────────────────────────

  async ensureCard(chatId: string, turnId: string): Promise<string> {
    const key = keyOf(chatId, turnId);
    const existing = this.cardTokenByTurn.get(key);
    if (existing) return existing;

    const pending = this.cardCreatePending.get(key);
    if (pending) return pending;

    const promise = (async () => {
      this.log.info({ chatId, turnId }, "creating card");
      const state = this.getOrCreateState(chatId, turnId);
      const token = this.supportsNativeStreaming()
        ? await this.createNativeStreamingCard(chatId, turnId, state)
        : await this.client.sendInteractiveCard(chatId, this.renderCard(state));
      this.log.info({ chatId, turnId, token }, "card created");
      this.cardTokenByTurn.set(key, token);
      this.cardCreatePending.delete(key);
      return token;
    })();
    this.cardCreatePending.set(key, promise);
    return promise;
  }

  private cleanupTurn(chatId: string, turnId: string): void {
    const key = keyOf(chatId, turnId);
    this.cardTokenByTurn.delete(key);
    this.cardCreatePending.delete(key);
    this.cardState.delete(key);
    this.nativeStreamSessions.delete(key);
    const timer = this.cardUpdateTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.cardUpdateTimers.delete(key);
    }
    this.cardDirty.delete(key);

  }

  // ── Throttled Updates ────────────────────────────────────────────────────

  async scheduleCardUpdate(chatId: string, turnId: string, force = false): Promise<void> {
    const key = keyOf(chatId, turnId);
    this.cardDirty.add(key);

    if (force || this.cardThrottleMs <= 0) {
      const existing = this.cardUpdateTimers.get(key);
      if (existing) {
        clearTimeout(existing);
        this.cardUpdateTimers.delete(key);
      }
      await this.flushCardUpdate(chatId, turnId);
      return;
    }

    if (this.cardUpdateTimers.has(key)) return;

    const timer = setTimeout(() => {
      this.cardUpdateTimers.delete(key);
      this.flushCardUpdate(chatId, turnId).catch((err) => {
        this.log.warn({ err, chatId, turnId }, "flushCardUpdate error");
      });
    }, this.cardThrottleMs);

    this.cardUpdateTimers.set(key, timer);
  }

  private async flushCardUpdate(chatId: string, turnId: string): Promise<void> {
    const key = keyOf(chatId, turnId);
    if (!this.cardDirty.has(key)) return;
    this.cardDirty.delete(key);
    const state = this.cardState.get(key);
    if (!state) return;
    const token = await this.ensureCard(chatId, turnId);
    await this.client.updateInteractiveCard(token, this.renderCard(state));
  }

  // ── Stream Aggregation Delegates ─────────────────────────────────────────

  appendContent(chatId: string, turnId: string, delta: string): void {
    if (this.isTerminalInterrupted(this.cardState.get(keyOf(chatId, turnId)))) return;
    if (this.supportsNativeStreaming()) {
      const state = this.getOrCreateState(chatId, turnId);
      state.message += delta;
      this.ensureCard(chatId, turnId)
        .then(() => this.requestNativeStreamTextSync(chatId, turnId, STREAM_MSG_ELEMENT_ID, this.renderStreamingMessage(state), { reason: "appendContent" }))
        .catch((err) => { this.log.warn({ err, chatId, turnId }, "appendContent(native) error"); });
      return;
    }
    this.streamAggregator.push(
      { delta },
      (aggregated) => {
        const state = this.getOrCreateState(chatId, turnId);
        state.message += aggregated.delta;
        this.ensureCard(chatId, turnId)
          .then(() => this.scheduleCardUpdate(chatId, turnId))
          .catch((err) => { this.log.warn({ err, chatId, turnId }, "appendContent error"); });
      },
      `${chatId}:${turnId}:content`
    );
  }

  appendReasoning(chatId: string, turnId: string, delta: string): void {
    if (this.isTerminalInterrupted(this.cardState.get(keyOf(chatId, turnId)))) return;
    if (this.supportsNativeStreaming()) {
      const state = this.getOrCreateState(chatId, turnId);
      state.thinking += delta;
      this.ensureCard(chatId, turnId)
        .then(() => this.requestNativeStreamTextSync(chatId, turnId, STREAM_THINK_ELEMENT_ID, this.renderStreamingThinking(state), { reason: "appendReasoning" }))
        .catch((err) => { this.log.warn({ err, chatId, turnId }, "appendReasoning(native) error"); });
      return;
    }
    this.streamAggregator.push(
      { delta },
      (aggregated) => {
        const state = this.getOrCreateState(chatId, turnId);
        state.thinking += aggregated.delta;
        this.ensureCard(chatId, turnId)
          .then(() => this.scheduleCardUpdate(chatId, turnId))
          .catch((err) => { this.log.warn({ err, chatId, turnId }, "appendReasoning error"); });
      },
      `${chatId}:${turnId}:reasoning`
    );
  }

  appendPlan(chatId: string, turnId: string, delta: string): void {
    if (this.isTerminalInterrupted(this.cardState.get(keyOf(chatId, turnId)))) return;
    if (this.supportsNativeStreaming()) {
      const state = this.getOrCreateState(chatId, turnId);
      state.planDraft = (state.planDraft ?? "") + delta;
      this.ensureCard(chatId, turnId)
        .then(() => this.requestNativeStreamTextSync(chatId, turnId, STREAM_PROGRESS_ELEMENT_ID, this.renderStreamingProgress(state), { reason: "appendPlan" }))
        .catch((err) => { this.log.warn({ err, chatId, turnId }, "appendPlan(native) error"); });
      return;
    }
    this.streamAggregator.push(
      { delta },
      (aggregated) => {
        const state = this.getOrCreateState(chatId, turnId);
        state.planDraft = (state.planDraft ?? "") + aggregated.delta;
        this.ensureCard(chatId, turnId)
          .then(() => this.scheduleCardUpdate(chatId, turnId))
          .catch((err) => { this.log.warn({ err, chatId, turnId }, "appendPlan error"); });
      },
      `${chatId}:${turnId}:plan`
    );
  }

  async updatePlan(chatId: string, update: IMPlanUpdate): Promise<void> {
    const state = this.getOrCreateState(chatId, update.turnId);
    if (this.isTerminalInterrupted(state)) return;
    state.planState = {
      explanation: update.explanation,
      items: update.plan.filter((item) => item.step.trim().length > 0)
    };
    state.planDraft = undefined;
    try {
      await this.ensureCard(chatId, update.turnId);
      if (this.supportsNativeStreaming()) {
        await this.requestNativeStreamTextSync(chatId, update.turnId, STREAM_PROGRESS_ELEMENT_ID, this.renderStreamingProgress(state), { force: true, reason: "plan_update" });
      }
      await this.scheduleCardUpdate(chatId, update.turnId, true);
    } catch (err) {
      this.log.warn({ err, chatId, turnId: update.turnId }, "updatePlan error");
    }
  }

  appendToolOutput(chatId: string, chunk: IMToolOutputChunk): void {
    if (this.isTerminalInterrupted(this.cardState.get(keyOf(chatId, chunk.turnId)))) return;
    if (this.supportsNativeStreaming()) {
      const state = this.getOrCreateState(chatId, chunk.turnId);
      const existing = state.toolOutputs.get(chunk.callId);
      if (existing) {
        existing.output += chunk.delta;
        if (existing.output.length > 2000) {
          existing.output = "..." + existing.output.slice(-1997);
        }
      } else {
        const label = state.callIdToLabel.get(chunk.callId) ?? chunk.callId;
        state.toolOutputs.set(chunk.callId, { command: label, output: chunk.delta });
      }
      this.ensureCard(chatId, chunk.turnId)
        .then(() => this.requestNativeStreamTextSync(chatId, chunk.turnId, STREAM_TOOLS_ELEMENT_ID, this.renderStreamingTools(state), { reason: "appendToolOutput" }))
        .catch((err) => { this.log.warn({ err, chatId, turnId: chunk.turnId }, "appendToolOutput(native) error"); });
      return;
    }
    this.streamAggregator.push(
      { delta: chunk.delta },
      (aggregated) => {
        const state = this.getOrCreateState(chatId, chunk.turnId);
        const existing = state.toolOutputs.get(chunk.callId);
        if (existing) {
          existing.output += aggregated.delta;
          if (existing.output.length > 2000) {
            existing.output = "..." + existing.output.slice(-1997);
          }
        } else {
          const label = state.callIdToLabel.get(chunk.callId) ?? chunk.callId;
          state.toolOutputs.set(chunk.callId, { command: label, output: aggregated.delta });
        }
        this.ensureCard(chatId, chunk.turnId)
          .then(() => this.scheduleCardUpdate(chatId, chunk.turnId))
          .catch((err) => { this.log.warn({ err, chatId, turnId: chunk.turnId }, "appendToolOutput error"); });
      },
      `${chatId}:${chunk.turnId}:toolout:${chunk.callId}`
    );
  }

  async updateProgress(chatId: string, event: IMProgressEvent): Promise<void> {
    const state = this.getOrCreateState(chatId, event.turnId);
    if (this.isTerminalInterrupted(state)) return;
    const s = getFeishuTurnCardStrings(this.locale);
    const icon = progressIcon(event, this.locale);
    const label = event.label;

    if (event.callId) {
      if (event.tool === "exec_command") {
        state.callIdToLabel.set(event.callId, label);
      } else if (event.tool === "patch_apply" && event.targetFile) {
        state.callIdToLabel.set(event.callId, s.patchPrefix(event.targetFile));
      } else if (event.tool === "patch_apply") {
        state.callIdToLabel.set(event.callId, s.applyPatch);
      }
    }

    if (event.phase === "end") {
      const beginPrefix = s.running;
      const beginIdx = state.tools.findIndex((t) => t.includes(label) && t.startsWith(beginPrefix));
      if (beginIdx >= 0) {
        state.tools[beginIdx] = `${icon} ${label}`;
      } else {
        state.tools.push(`${icon} ${label}`);
      }

      if (event.summary && event.callId) {
        const existing = state.toolOutputs.get(event.callId);
        if (existing) {
          existing.output = event.summary;
        } else {
          state.toolOutputs.set(event.callId, { command: label, output: event.summary });
        }
      }
    } else {
      state.tools.push(`${icon} ${label}`);
    }

    if (event.tool === "collab_agent" && event.agentId) {
      state.agentNote = s.childAgentWorking(event.agentId);
    }
    if (this.supportsNativeStreaming()) {
      try {
        await this.ensureCard(chatId, event.turnId);
        this.requestNativeStreamTextSync(chatId, event.turnId, STREAM_PROGRESS_ELEMENT_ID, this.renderStreamingProgress(state), { reason: `progress:${event.phase}:${event.tool}` });
        this.requestNativeStreamTextSync(chatId, event.turnId, STREAM_TOOLS_ELEMENT_ID, this.renderStreamingTools(state), { reason: `progress:${event.phase}:${event.tool}` });
        this.requestNativeStreamTextSync(chatId, event.turnId, STREAM_FOOTER_ELEMENT_ID, this.renderStreamingFooter(state), { reason: `progress:${event.phase}:${event.tool}` });
      } catch (err) {
        this.log.warn({ err, chatId, turnId: event.turnId }, "updateProgress(native) error");
      }
      return;
    }
    try {
      await this.ensureCard(chatId, event.turnId);
      await this.scheduleCardUpdate(chatId, event.turnId);
    } catch (err) {
      this.log.warn({ err, chatId, turnId: event.turnId }, "updateProgress error");
    }
  }

  // ── Notification Handling ────────────────────────────────────────────────

  async handleNotify(chatId: string, notif: {
    turnId?: string;
    category: string;
    title: string;
    lastAgentMessage?: string;
    tokenUsage?: { input: number; output: number; total?: number };
  }): Promise<"handled" | "passthrough"> {
    if (!notif.turnId) return "passthrough";

    const state = this.getOrCreateState(chatId, notif.turnId);
    const s = getFeishuTurnCardStrings(this.locale);
    if (notif.category === "token_usage" && notif.tokenUsage) {
      state.tokenUsage = notif.tokenUsage;
      // Refresh streaming footer so users see token count incrementing during reasoning gaps
      if (this.supportsNativeStreaming() && !this.isTerminalInterrupted(state)) {
        await this.ensureCard(chatId, notif.turnId);
        await this.requestNativeStreamTextSync(chatId, notif.turnId, STREAM_FOOTER_ELEMENT_ID, this.renderStreamingFooter(state), { force: true, reason: "notification:token_usage" });
      }
      return "handled";
    }
    if (notif.category === "turn_complete") {
      if (notif.lastAgentMessage) {
        state.message = notif.lastAgentMessage;
      }
      return "handled";
    }
    if (notif.category === "agent_message" && notif.lastAgentMessage) {
      state.message = notif.lastAgentMessage;
      if (this.isTerminalInterrupted(state)) {
        return "handled";
      }
      if (this.supportsNativeStreaming()) {
        await this.ensureCard(chatId, notif.turnId);
        await this.requestNativeStreamTextSync(chatId, notif.turnId, STREAM_MSG_ELEMENT_ID, this.renderStreamingMessage(state), { force: true, reason: "notification:agent_message" });
        return "handled";
      }
      await this.scheduleCardUpdate(chatId, notif.turnId, true);
      return "handled";
    }
    if (notif.category === "turn_started") {
      await this.ensureCard(chatId, notif.turnId);
      return "handled";
    }
    if (notif.category === "turn_aborted") {
      state.actionTaken = "interrupted";
      state.interruptedAt = new Date().toISOString();
      state.footer = s.footerAborted(s.actionInterrupted, toTokenText(state.tokenUsage), computeFileStats(state.fileChanges).totalFiles);
      const session = this.nativeStreamSessions.get(keyOf(chatId, notif.turnId));
      if (session?.streamingActive && !session.degraded) {
        await this.disableNativeStreaming(chatId, notif.turnId);
      }
      this.cardDirty.add(keyOf(chatId, notif.turnId));
      await this.flushCardUpdate(chatId, notif.turnId);
      return "handled";
    }
    // Show warning/status notifications as progress entries in the streaming card
    if (notif.category === "warning" && notif.turnId) {
      if (this.isTerminalInterrupted(state)) return "handled";
      state.tools.push(`⚡ ${notif.title}`);
      if (this.supportsNativeStreaming()) {
        await this.ensureCard(chatId, notif.turnId);
        this.requestNativeStreamTextSync(chatId, notif.turnId, STREAM_PROGRESS_ELEMENT_ID, this.renderStreamingProgress(state), { reason: "notification:warning" });
        this.requestNativeStreamTextSync(chatId, notif.turnId, STREAM_TOOLS_ELEMENT_ID, this.renderStreamingTools(state), { reason: "notification:warning" });
        return "handled";
      }
      await this.scheduleCardUpdate(chatId, notif.turnId);
      return "handled";
    }
    return "passthrough";
  }

  // ── Complete Turn ────────────────────────────────────────────────────────

  async completeTurn(chatId: string, summary: IMTurnSummary): Promise<void> {
    const s = getFeishuTurnCardStrings(this.locale);
    const state = this.getOrCreateState(chatId, summary.turnId);
    const alreadyInterrupted = this.isTerminalInterrupted(state);
    state.tokenUsage = summary.tokenUsage;
    state.threadName = summary.threadName ?? state.threadName;
    if (summary.lastAgentMessage) {
      state.message = summary.lastAgentMessage;
    }
    state.promptSummary = state.promptSummary || extractKeywords(summary.lastAgentMessage);
    if (summary.fileChangeDetails && summary.fileChangeDetails.length > 0) {
      for (const detail of summary.fileChangeDetails) {
        state.fileChanges.push({
          filesChanged: detail.filesChanged,
          diffSummary: detail.diffSummary,
          stats: detail.stats,
          diffFiles: detail.diffFiles ?? [],
          diffSegments: detail.diffSegments ?? [],
        });
      }
    }
    if (alreadyInterrupted) {
      state.footer = s.footerAborted(s.actionInterrupted, toTokenText(summary.tokenUsage), summary.filesChanged.length);
    } else {
      state.footer = s.footerDone(toTokenText(summary.tokenUsage), summary.filesChanged.length);
    }

    const nativeSession = this.nativeStreamSessions.get(keyOf(chatId, summary.turnId));
    if (nativeSession && nativeSession.streamingActive && !nativeSession.degraded) {
      await this.requestNativeStreamTextSync(chatId, summary.turnId, STREAM_MSG_ELEMENT_ID, this.renderStreamingMessage(state), { force: true, reason: "completeTurn:message" });
      await this.requestNativeStreamTextSync(chatId, summary.turnId, STREAM_THINK_ELEMENT_ID, this.renderStreamingThinking(state), { force: true, reason: "completeTurn:thinking" });
      await this.requestNativeStreamTextSync(chatId, summary.turnId, STREAM_PROGRESS_ELEMENT_ID, this.renderStreamingProgress(state), { force: true, reason: "completeTurn:progress" });
      await this.requestNativeStreamTextSync(chatId, summary.turnId, STREAM_TOOLS_ELEMENT_ID, this.renderStreamingTools(state), { force: true, reason: "completeTurn:tools" });
      await this.requestNativeStreamTextSync(chatId, summary.turnId, STREAM_FOOTER_ELEMENT_ID, this.renderStreamingFooter(state), { force: true, reason: "completeTurn:footer" });
      await this.disableNativeStreaming(chatId, summary.turnId);
      await this.syncNativeActionElement(chatId, summary.turnId);
    }

    this.cardDirty.add(keyOf(chatId, summary.turnId));
    await this.flushCardUpdate(chatId, summary.turnId);

    if (alreadyInterrupted) {
      return;
    }

    // Pin 卡片 + 发送完成提醒
    const key = keyOf(chatId, summary.turnId);
    const cardToken = this.cardTokenByTurn.get(key);
    if (cardToken) {
      try {
        await this.client.pinMessage?.(cardToken);
      } catch (error) {
        this.log.warn({ chatId, turnId: summary.turnId, cardToken, err: error instanceof Error ? error.message : String(error) }, "pin turn card failed");
      }
    }
    try {
      const parts: string[] = ["✅"];
      if (state.threadName) parts.push(formatThreadNameLabel(state.threadName, this.locale)!);
      if (state.turnNumber) parts.push(`turn-${state.turnNumber}`);
      parts.push(s.done);
      if (summary.filesChanged.length > 0) parts.push(s.fileChanges(summary.filesChanged.length));
      parts.push(`${toTokenText(summary.tokenUsage)} tokens`);
      await this.client.sendMessage({ chatId, text: parts.join(" · ") });
    } catch (error) {
      this.log.warn({ chatId, turnId: summary.turnId, err: error instanceof Error ? error.message : String(error) }, "send turn completion notice failed");
    }



    try {
      this.onTurnComplete?.(chatId, summary);
    } catch (error) {
      this.log.warn({ chatId, turnId: summary.turnId, err: error instanceof Error ? error.message : String(error) }, "onTurnComplete callback failed");
    }
  }

  // ── Card Action (Accept / Revert / Interrupt) ────────────────────────────

  prepareInterruptingCard(chatId: string, turnId: string, meta?: InterruptActionMeta): Record<string, unknown> | null {
    const key = keyOf(chatId, turnId);
    const state = this.cardState.get(key);
    this.log.info({ key, hasState: !!state }, "prepareInterruptingCard");
    if (!state) {
      this.log.warn({ key }, "prepareInterruptingCard: no cached state");
      return null;
    }
    if (this.isInterrupted(state)) {
      return this.renderCard(state);
    }
    state.actionTaken = "interrupting";
    state.interruptedBy = meta?.actorName ?? state.interruptedBy;
    state.interruptRequestedAt = meta?.requestedAt ?? new Date().toISOString();
    state.footer = getFeishuTurnCardStrings(this.locale).footerAborted(
      getFeishuTurnCardStrings(this.locale).actionInterrupting,
      toTokenText(state.tokenUsage),
      computeFileStats(state.fileChanges).totalFiles
    );
    return this.renderCard(state);
  }

  async finalizeInterruptAction(chatId: string, turnId: string): Promise<void> {
    const key = keyOf(chatId, turnId);
    const state = this.cardState.get(key);
    this.log.info({ key, hasState: !!state }, "finalizeInterruptAction");
    if (!state) {
      return;
    }
    const session = this.nativeStreamSessions.get(key);
    if (session?.streamingActive && !session.degraded) {
      await this.disableNativeStreaming(chatId, turnId);
    }
    this.cardDirty.add(key);
    await this.flushCardUpdate(chatId, turnId);
  }

  async cancelInterruptingCard(chatId: string, turnId: string): Promise<void> {
    const key = keyOf(chatId, turnId);
    const state = this.cardState.get(key);
    this.log.info({ key, hasState: !!state }, "cancelInterruptingCard");
    if (!state || state.actionTaken !== "interrupting") {
      return;
    }
    state.actionTaken = undefined;
    state.footer = "";
    this.cardDirty.add(key);
    await this.flushCardUpdate(chatId, turnId);
  }

  async updateCardAction(chatId: string, turnId: string, action: "accepted" | "reverted" | "interrupting" | "interrupted", meta?: InterruptActionMeta): Promise<Record<string, unknown> | null> {
    const key = keyOf(chatId, turnId);
    let state = this.cardState.get(key);
    this.log.info({ key, action, hasState: !!state }, "updateCardAction");

    // 从 L2 TurnCardDataProvider 恢复卡片状态（重启后恢复）
    if (!state && this.turnCardReader) {
      try {
        const projectId = this.turnCardReader.resolveProjectId(chatId);
        if (!projectId) {
          throw new Error(`project not found for chatId: ${chatId}`);
        }
        const data = await this.turnCardReader.getTurnCardData({ projectId, turnId });
        if (data) {
          this.log.info({ key }, "updateCardAction: recovered state from L2");
          const s = getFeishuTurnCardStrings(this.locale);
          state = {
            chatId, turnId: data.turnId,
            threadName: data.threadName,
            turnNumber: data.turnNumber,
            thinking: data.reasoning ?? "",
            message: data.message ?? "",
            tools: data.tools.map(t => t.label),
            fileChanges: data.fileChanges,
            toolOutputs: new Map(
              data.toolOutputs.map(e => [e.callId, { command: e.command, output: e.output }])
            ),
            planState: data.planState,
            callIdToLabel: new Map(), footer: s.footerDone(toTokenText(data.tokenUsage), data.fileChanges.reduce((sum, fc) => sum + fc.filesChanged.length, 0)),
            tokenUsage: data.tokenUsage,
            promptSummary: data.promptSummary,
            backendName: data.backendName,
            modelName: data.modelName,
            agentNote: data.agentNote,
            turnMode: data.turnMode,
          };
          this.cardState.set(key, state);
        }
      } catch (error) {
        this.log.warn({ key, err: error instanceof Error ? error.message : String(error) }, "updateCardAction: L2 recovery failed");
      }
    }

    if (!state) {
      this.log.warn({ key }, "updateCardAction: no state, cannot update card");
      return null;
    }
    if (action === "interrupting" && this.isInterrupted(state)) {
      return this.renderCard(state);
    }
    state.actionTaken = action;
    if (action === "interrupting") {
      state.interruptedBy = meta?.actorName ?? state.interruptedBy;
      state.interruptRequestedAt = meta?.requestedAt ?? new Date().toISOString();
      state.footer = getFeishuTurnCardStrings(this.locale).footerAborted(
        getFeishuTurnCardStrings(this.locale).actionInterrupting,
        toTokenText(state.tokenUsage),
        computeFileStats(state.fileChanges).totalFiles
      );
      const session = this.nativeStreamSessions.get(key);
      if (session?.streamingActive && !session.degraded) {
        await this.disableNativeStreaming(chatId, turnId);
      }
      this.cardDirty.add(key);
      await this.flushCardUpdate(chatId, turnId);
      return this.renderCard(state);
    }
    if (action === "interrupted") {
      state.interruptedBy = meta?.actorName ?? state.interruptedBy;
      state.interruptRequestedAt = meta?.requestedAt ?? state.interruptRequestedAt;
      state.interruptedAt = meta?.requestedAt ?? state.interruptedAt ?? new Date().toISOString();
      state.footer = getFeishuTurnCardStrings(this.locale).footerAborted(
        getFeishuTurnCardStrings(this.locale).actionInterrupted,
        toTokenText(state.tokenUsage),
        computeFileStats(state.fileChanges).totalFiles
      );
      const session = this.nativeStreamSessions.get(key);
      if (session?.streamingActive && !session.degraded) {
        await this.disableNativeStreaming(chatId, turnId);
      }
      this.cardDirty.add(key);
      await this.flushCardUpdate(chatId, turnId);
    }
    const card = this.renderCard(state);
    return card;
  }

  getTurnCardThreadName(chatId: string, turnId: string): string | undefined {
    return this.getCachedState(chatId, turnId)?.threadName;
  }

  // ── Card Rendering ───────────────────────────────────────────────────────

  renderCard(state: TurnCardState): Record<string, unknown> {
    const isDone = state.footer.startsWith("✅");
    const isInterrupting = this.isInterruptPending(state);
    const isInterrupted = this.isInterrupted(state);
    const isRunning = !isDone && !isInterrupting && !isInterrupted;
    if (isRunning) {
      const streamingSession = this.nativeStreamSessions.get(keyOf(state.chatId, state.turnId));
      if (streamingSession && streamingSession.streamingActive && !streamingSession.degraded) {
        return this.renderStreamingCard(state);
      }
    }
    const s = getFeishuTurnCardStrings(this.locale);
    const statusText = isDone ? s.statusDone : isInterrupting ? s.actionInterrupting : isInterrupted ? s.statusAbortedLabel : s.statusRunning;
    const statusColor = isDone ? "green" : isInterrupting ? "blue" : isInterrupted ? "red" : "blue";
    const headerTemplate = isDone ? "green" : isInterrupting ? "turquoise" : isInterrupted ? "red" : "turquoise";
    const headerIcon = isDone ? "done_outlined" : isInterrupting ? "loading_outlined" : isInterrupted ? "close_outlined" : "loading_outlined";
    const tokenText = toTokenText(state.tokenUsage);

    // ── File change stats (for header tags + button label) ─────────────
    const { totalFiles: totalFilesChanged, totalAdd, totalDel } = computeFileStats(state.fileChanges);

    // ── Tool stats (for button label) ─────────────────────────────────
    const { stepCount } = computeToolStats(state, this.locale);

    // ── Header tags ──────────────────────────────────────────────────────
    const headerTags: Record<string, unknown>[] = [
      { tag: "text_tag", text: { tag: "plain_text", content: statusText }, color: statusColor }
    ];
    if (tokenText !== "-") {
      headerTags.push({ tag: "text_tag", text: { tag: "plain_text", content: `${tokenText} tok` }, color: "neutral" });
    }
    if (totalFilesChanged > 0) {
      headerTags.push({ tag: "text_tag", text: { tag: "plain_text", content: s.fileChanges(totalFilesChanged) }, color: "turquoise" });
    }

    // ── Body elements ────────────────────────────────────────────────────
    const bodyElements: Record<string, unknown>[] = [];

    // Message
    if (state.message) {
      const msg = state.message.length > 3000
        ? state.message.slice(0, 3000) + `\n\n${s.truncated}`
        : state.message;
      bodyElements.push({ tag: "markdown", content: msg });
    } else if (isInterrupting) {
      bodyElements.push(greyText(s.actionInterrupting));
    } else if (!isDone && state.tools.length === 0 && state.toolOutputs.size === 0 && state.fileChanges.length === 0) {
      bodyElements.push(greyText(s.waitingOutput));
    }

    if (state.interruptedBy || state.interruptRequestedAt || state.interruptedAt) {
      bodyElements.push({ tag: "hr" });
      if (state.interruptedBy) {
        bodyElements.push(greyText(isInterrupted ? s.interruptedBy(state.interruptedBy) : s.interruptRequestedBy(state.interruptedBy)));
      }
      const requestedAt = formatEventTime(state.interruptRequestedAt);
      if (requestedAt && !isInterrupted) {
        bodyElements.push(greyText(s.interruptRequestedAt(requestedAt)));
      }
      const interruptedAt = formatEventTime(state.interruptedAt);
      if (interruptedAt && isInterrupted) {
        bodyElements.push(greyText(s.interruptedAt(interruptedAt)));
      }
    }

    // Thinking
    if (state.thinking && state.thinking.trim().length > 0) {
      const thinkLen = state.thinking.length;
      const thinkLabel = thinkLen > 1000 ? `${(thinkLen / 1000).toFixed(1)}k chars` : `${thinkLen} chars`;
      bodyElements.push({ tag: "hr" });
      bodyElements.push({
        tag: "collapsible_panel",
        expanded: false,
        header: {
          title: { tag: "markdown", content: s.thinkingProcess(thinkLabel) },
          icon: { tag: "standard_icon", token: "chat_outlined", color: "grey", size: "16px 16px" },
          icon_position: "follow_text", icon_expanded_angle: -180
        },
        background_color: "grey",
        vertical_spacing: "2px",
        elements: [{ tag: "markdown", content: thinkLen > 2000 ? state.thinking.slice(0, 2000) + `\n\n${s.truncated}` : state.thinking }]
      });
    }

    if (state.planState && (state.planState.items.length > 0 || state.planState.explanation)) {
      bodyElements.push({ tag: "hr" });
      bodyElements.push({
        tag: "collapsible_panel",
        expanded: true,
        header: {
          title: { tag: "markdown", content: s.executePlan },
          icon: { tag: "standard_icon", token: "list-check_outlined", color: "blue", size: "16px 16px" },
          icon_position: "follow_text", icon_expanded_angle: -180
        },
        background_color: "default",
        vertical_spacing: "2px",
        elements: [{ tag: "markdown", content: renderPlanMarkdown(state.planState, this.locale) }]
      });
    }

    // Progress button — navigate to tool detail sub-page
    if (stepCount > 0) {
      bodyElements.push({ tag: "hr" });
      bodyElements.push({
        tag: "interactive_container",
        width: "fill", height: "auto",
        has_border: true, border_color: "grey", corner_radius: "8px",
        padding: "10px 12px 10px 12px",
        behaviors: [{ type: "callback", value: { action: "view_tool_progress", chatId: state.chatId, turnId: state.turnId, page: 0 } }],
        elements: [{
          tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
          columns: [
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [{
                tag: "markdown", content: s.executeProcess(stepCount),
                icon: { tag: "standard_icon", token: "list-check_outlined", color: "blue" }
              }]
            },
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [greyText(s.clickViewDetails)]
            }
          ]
        }]
      });
    }

    // File changes button — navigate to file detail sub-page
    if (totalFilesChanged > 0) {
      bodyElements.push({ tag: "hr" });
      bodyElements.push({
        tag: "interactive_container",
        width: "fill", height: "auto",
        has_border: true, border_color: "grey", corner_radius: "8px",
        padding: "10px 12px 10px 12px",
        behaviors: [{ type: "callback", value: { action: "view_file_changes", chatId: state.chatId, turnId: state.turnId, page: 0 } }],
        elements: [{
          tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
          columns: [
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [{
                tag: "markdown", content: s.fileModify(totalFilesChanged, totalAdd, totalDel),
                icon: { tag: "standard_icon", token: "code_outlined", color: "turquoise" }
              }]
            },
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [greyText(s.clickViewDiff)]
            }
          ]
        }]
      });
    }

    // Agent note
    if (state.agentNote) {
      bodyElements.push(greyText(state.agentNote));
    }

    // ── Action buttons — interactive_container style (matching /help) ────
    if (isRunning) {
      bodyElements.push({ tag: "hr" });
      bodyElements.push({
        tag: "interactive_container",
        width: "fill", height: "auto",
        has_border: true, border_color: "grey", corner_radius: "8px",
        padding: "10px 12px 10px 12px",
        confirm: {
          title: { tag: "plain_text", content: s.confirmStopTitle },
          text: { tag: "plain_text", content: s.confirmStopText }
        },
        behaviors: [{ type: "callback", value: { action: "interrupt", chatId: state.chatId, turnId: state.turnId } }],
        elements: [{
          tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
          columns: [
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [{
                tag: "markdown", content: s.stopExecution,
                icon: { tag: "standard_icon", token: "close_outlined", color: "red" }
              }]
            },
            {
              tag: "column", width: "weighted", weight: 1, vertical_align: "center",
              elements: [greyText(s.stopAgentTask)]
            }
          ]
        }]
      });
    } else if (isInterrupting || isInterrupted) {
      bodyElements.push({ tag: "hr" });
      bodyElements.push(greyText(isInterrupting ? s.actionInterrupting : s.actionInterrupted));
    } else if (!state.actionTaken && state.fileChanges.length > 0) {
      bodyElements.push({ tag: "hr" });
      bodyElements.push({
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
              behaviors: [{ type: "callback", value: { action: "accept_changes", chatId: state.chatId, turnId: state.turnId, threadName: state.threadName ?? "" } }],
              elements: [{
                tag: "markdown", content: s.approveChanges,
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
              confirm: {
                title: { tag: "plain_text", content: s.confirmRevertTitle },
                text: { tag: "plain_text", content: s.confirmRevertText }
              },
              behaviors: [{ type: "callback", value: { action: "revert_changes", chatId: state.chatId, turnId: state.turnId, threadName: state.threadName ?? "" } }],
              elements: [{
                tag: "markdown", content: s.revertChanges,
                icon: { tag: "standard_icon", token: "undo_outlined", color: "red" }
              }]
            }]
          }
        ]
      });
    } else if (!state.actionTaken && state.fileChanges.length === 0 && isDone) {
      bodyElements.push({ tag: "hr" });
      bodyElements.push(greyText(s.doneNoFileChanges));
    } else {
      bodyElements.push({ tag: "hr" });
      const actionLabel = state.actionTaken === "accepted" ? s.actionAccepted
        : state.actionTaken === "reverted" ? s.actionReverted
          : state.actionTaken === "interrupting" ? s.actionInterrupting
          : state.actionTaken === "interrupted" ? s.actionInterrupted
            : state.actionTaken ?? s.actionProcessed;
      bodyElements.push(greyText(actionLabel));
    }

    // ── Header title: <Mode>: keywords ────────────────────────────────
    const modeLabel = state.turnMode === "plan" ? s.planMode : s.agentMode;
    const headerTitle = isDone || isInterrupted
      ? (state.promptSummary
          ? `${modeLabel}: ${state.promptSummary}`
          : modeLabel)
      : isInterrupting ? `${modeLabel} ⏳` : `${modeLabel} ⏳`;

    return {
      schema: "2.0",
      config: { width_mode: "fill", update_multi: true },
      header: {
        title: {
          tag: "plain_text",
          content: headerTitle
        },
        subtitle: {
          tag: "plain_text",
          content: [
            formatThreadNameLabel(state.threadName, this.locale),
            state.turnNumber ? `turn-${state.turnNumber}` : null,
            state.backendName || null,
            state.modelName || null
          ].filter(Boolean).join(" \u00b7 ")
        },
        icon: { tag: "standard_icon", token: headerIcon, color: statusColor },
        text_tag_list: headerTags,
        template: headerTemplate
      },
      body: {
        direction: "vertical",
        vertical_spacing: "8px",
        padding: "4px 12px 12px 12px",
        elements: bodyElements
      }
    };
  }

  private buildHistoricalState(input: HistoricalTurnCardInput): TurnCardState {
    const s = getFeishuTurnCardStrings(this.locale);
    const tokenText = toTokenText(input.tokenUsage);
    const footerParts = [`✅ ${s.done}`];
    if (tokenText !== "-") footerParts.push(`${tokenText} tokens`);
    if (input.fileChanges.length > 0) footerParts.push(s.fileChanges(computeFileStats(input.fileChanges).totalFiles));
    return {
      chatId: input.chatId,
      turnId: input.turnId,
      threadName: input.threadName,
      turnNumber: input.turnNumber,
      backendName: input.backendName,
      modelName: input.modelName,
      thinking: input.thinking ?? "",
      message: input.message ?? "",
      tools: (input.tools ?? []).map((tool) => historicalToolLine(tool, this.locale)),
      fileChanges: input.fileChanges,
      planDraft: undefined,
      toolOutputs: new Map((input.toolOutputs ?? []).map((item) => [item.callId, { command: item.command, output: item.output }])),
      planState: input.planState,
      callIdToLabel: new Map(),
      footer: footerParts.join(" · "),
      tokenUsage: input.tokenUsage,
      promptSummary: input.promptSummary,
      agentNote: input.agentNote ? s.childAgentNote(input.agentNote) : undefined,
      actionTaken: input.actionTaken,
      interruptedBy: input.interruptedBy,
      interruptRequestedAt: input.interruptRequestedAt,
      interruptedAt: input.interruptedAt,
      turnMode: input.turnMode
    };
  }

  cacheHistoricalState(input: HistoricalTurnCardInput): TurnCardState {
    const state = this.buildHistoricalState(input);
    const key = keyOf(input.chatId, input.turnId);
    this.cardState.set(key, state);
    // 仅内存缓存，不再持久化（内容已在 L2 TurnDetailRecord 中）
    return state;
  }

  renderHistoricalCard(input: HistoricalTurnCardInput): Record<string, unknown> {
    const state = this.buildHistoricalState(input);
    return this.renderCard(state);
  }

  private supportsNativeStreaming(): boolean {
    return typeof this.client.createCardEntity === "function"
      && typeof this.client.sendCardEntity === "function"
      && typeof this.client.updateCardSettings === "function"
      && typeof this.client.streamCardElement === "function";
  }

  private supportsNativeComponentUpdate(): boolean {
    return typeof this.client.updateCardElement === "function";
  }

  private async createNativeStreamingCard(chatId: string, turnId: string, state: TurnCardState): Promise<string> {
    const key = keyOf(chatId, turnId);
    const existing = this.nativeStreamSessions.get(key);
    if (existing) {
      return existing.messageId;
    }
    let cardId = "";
    try {
      cardId = await this.client.createCardEntity!(this.renderStreamingCard(state));
    } catch (error) {
      this.log.warn({
        chatId,
        turnId,
        step: "createCardEntity",
        err: error instanceof Error
          ? (() => {
              const feishuError = error as Error & { status?: number; code?: number; details?: unknown };
              return { name: error.name, message: error.message, status: feishuError.status, code: feishuError.code, details: feishuError.details };
            })()
          : String(error)
      }, "createNativeStreamingCard failed");
      throw error;
    }
    let messageId = "";
    try {
      messageId = await this.client.sendCardEntity!(chatId, cardId);
    } catch (error) {
      this.log.warn({
        chatId,
        turnId,
        cardId,
        step: "sendCardEntity",
        err: error instanceof Error
          ? (() => {
              const feishuError = error as Error & { status?: number; code?: number; details?: unknown };
              return { name: error.name, message: error.message, status: feishuError.status, code: feishuError.code, details: feishuError.details };
            })()
          : String(error)
      }, "createNativeStreamingCard failed");
      throw error;
    }
    this.nativeStreamSessions.set(key, {
      cardId,
      messageId,
      sequence: 0,
      streamingActive: true,
      pending: Promise.resolve(),
      lastSent: new Map([
        [STREAM_MSG_ELEMENT_ID, this.renderStreamingMessage(state)],
        [STREAM_THINK_ELEMENT_ID, this.renderStreamingThinking(state)],
        [STREAM_PROGRESS_ELEMENT_ID, this.renderStreamingProgress(state)],
        [STREAM_TOOLS_ELEMENT_ID, this.renderStreamingTools(state)],
        [STREAM_FOOTER_ELEMENT_ID, this.renderStreamingFooter(state)]
      ]),
      degraded: false
    });
    return messageId;
  }

  private async syncNativeStreamText(chatId: string, turnId: string, elementId: string, content: string): Promise<void> {
    const key = keyOf(chatId, turnId);
    if (this.isTerminalInterrupted(this.cardState.get(key))) {
      return;
    }
    const session = this.nativeStreamSessions.get(key);
    if (!session || session.degraded || !session.streamingActive) {
      this.cardDirty.add(key);
      await this.flushCardUpdate(chatId, turnId);
      return;
    }
    const normalized = content || " ";
    if (session.lastSent.get(elementId) === normalized) {
      return;
    }
    session.lastSent.set(elementId, normalized);
    session.pending = session.pending
      .then(async () => {
        session.sequence += 1;
        await this.client.streamCardElement!(session.cardId, elementId, normalized, session.sequence);
      })
      .catch(async (error) => {
        const rateLimited = this.isFeishuRateLimitError(error);
      this.log.warn(
          { chatId, turnId, elementId, err: error instanceof Error ? error.message : String(error), rateLimited },
          rateLimited
            ? "native stream rate-limited; degrading to legacy card update"
            : "native stream failed; degrading to legacy card update"
        );
        session.degraded = true;
        session.streamingActive = false;
        this.cardDirty.add(key);
        await this.flushCardUpdate(chatId, turnId);
      });
    await session.pending;
  }

  private requestNativeStreamTextSync(
    chatId: string,
    turnId: string,
    elementId: string,
    content: string,
    options?: { force?: boolean; reason?: string }
  ): Promise<void> {
    this.log.info({
      chatId,
      turnId,
      elementId,
      reason: options?.reason ?? "unknown",
      contentLength: (content || " ").length,
      force: options?.force ?? false
    }, "native stream sync immediate");
    return this.syncNativeStreamText(chatId, turnId, elementId, content);
  }

  private isFeishuRateLimitError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }
    const maybeCode = (error as { code?: unknown; details?: { code?: unknown } }).code;
    const detailsCode = (error as { details?: { code?: unknown } }).details?.code;
    return maybeCode === 230020 || detailsCode === 230020;
  }

  private async disableNativeStreaming(chatId: string, turnId: string): Promise<void> {
    const session = this.nativeStreamSessions.get(keyOf(chatId, turnId));
    if (!session || session.degraded || !session.streamingActive) {
      return;
    }
    // Flip the in-memory gate immediately so any late async stream updates
    // fall back to card rendering instead of continuing to push streaming deltas
    // after the turn has entered interrupt/finalization flow.
    session.streamingActive = false;
    session.pending = session.pending.then(async () => {
      session.sequence += 1;
      await this.client.updateCardSettings!(session.cardId, { config: { streaming_mode: false } }, session.sequence);
    });
    await session.pending;
  }

  private async replaceNativeElement(chatId: string, turnId: string, elementId: string, element: Record<string, unknown>): Promise<void> {
    const key = keyOf(chatId, turnId);
    const session = this.nativeStreamSessions.get(key);
    if (!session || session.degraded || !this.supportsNativeComponentUpdate()) {
      this.cardDirty.add(key);
      await this.flushCardUpdate(chatId, turnId);
      return;
    }
    session.pending = session.pending
      .then(async () => {
        session.sequence += 1;
        await this.client.updateCardElement!(session.cardId, elementId, element, session.sequence);
      })
      .catch(async (error) => {
        this.log.warn({ chatId, turnId, elementId, err: error instanceof Error ? error.message : String(error) }, "native component update failed; degrading to legacy card update");
        session.degraded = true;
        session.streamingActive = false;
        this.cardDirty.add(key);
        await this.flushCardUpdate(chatId, turnId);
      });
    await session.pending;
  }

  private async syncNativeActionElement(chatId: string, turnId: string): Promise<void> {
    if (!this.supportsNativeComponentUpdate()) {
      return;
    }
    const state = this.cardState.get(keyOf(chatId, turnId));
    if (!state) {
      return;
    }
    await this.replaceNativeElement(chatId, turnId, STREAM_ACTIONS_ELEMENT_ID, this.renderFinalActionsElement(state));
  }

  private renderStreamingMessage(state: TurnCardState): string {
    const s = getFeishuTurnCardStrings(this.locale);
    return quoteMarkdown(s.replyTitle, state.message || s.waitingOutput);
  }

  private renderStreamingThinking(state: TurnCardState): string {
    const s = getFeishuTurnCardStrings(this.locale);
    return quoteMarkdown(s.thinkingTitle, state.thinking || s.waitingThinking);
  }

  private renderStreamingTools(state: TurnCardState): string {
    const s = getFeishuTurnCardStrings(this.locale);
    const parts: string[] = [];
    if (state.tools.length > 0) {
      parts.push(s.executionProgressSection);
      for (const item of state.tools.slice(-10)) {
        parts.push(`- ${item.replace(/<[^>]+>/g, "")}`);
      }
    }
    if (state.toolOutputs.size > 0) {
      parts.push(parts.length > 0 ? `\n${s.toolOutputSection}` : s.toolOutputSection);
      for (const { command, output } of [...state.toolOutputs.values()].slice(-3)) {
        parts.push(`- ${command}\n${output.slice(-1200)}`);
      }
    }
    if (state.agentNote) {
      parts.push(`\n${state.agentNote}`);
    }
    return quoteMarkdown(s.toolsTitle, parts.join("\n") || s.waitingToolOutput);
  }

  private renderStreamingProgress(state: TurnCardState): string {
    const s = getFeishuTurnCardStrings(this.locale);
    const { stepCount } = computeToolStats(state, this.locale);
    const parts: string[] = [];
    if (state.planState && (state.planState.items.length > 0 || state.planState.explanation)) {
      parts.push(renderPlanMarkdown(state.planState, this.locale));
    } else if (state.planDraft?.trim()) {
      parts.push(state.planDraft.trim());
    }
    if (stepCount > 0) {
      const latest = state.tools.slice(-3).map((item) => `- ${item.replace(/<[^>]+>/g, "")}`);
      parts.push(parts.length > 0 ? `\n${s.executionProgressSection}` : s.executionProgressSection);
      parts.push(...latest);
    }
    if (parts.length === 0) {
      return quoteMarkdown(s.progressTitle, s.waitingExecutionProgress);
    }
    return quoteMarkdown(s.progressTitle, parts.join("\n"));
  }

  private renderStreamingFooter(state: TurnCardState): string {
    const s = getFeishuTurnCardStrings(this.locale);
    if (state.footer) {
      return quoteMarkdown(s.statusTitle, state.footer);
    }
    const tokenText = toTokenText(state.tokenUsage);
    return quoteMarkdown(s.statusTitle, tokenText === "-" ? s.generating : s.generatingWithTokens(tokenText));
  }

  private renderStreamingActionPlaceholder(state: TurnCardState): string {
    const s = getFeishuTurnCardStrings(this.locale);
    if (state.footer.startsWith("✅")) {
      return quoteMarkdown(s.actionsTitle, s.loadingActions);
    }
    return quoteMarkdown(s.actionsTitle, s.actionsAvailableAfterCompletion);
  }

  /**
   * Render the interrupt button for streaming cards.
   * Uses interactive_container so it's clickable during streaming.
   * Verified: streaming_mode:true cards support mixed interactive_container + markdown elements.
   */
  private renderStreamingInterruptButton(state: TurnCardState): Record<string, unknown> {
    const s = getFeishuTurnCardStrings(this.locale);
    const isMergeResolver = state.isMergeResolver ?? false;
    const buttonLabel = isMergeResolver ? "**中断当前 Turn**" : s.stopExecution;
    const buttonHint = isMergeResolver ? "停止 Agent 当前轮次" : s.stopAgentTask;
    return {
      tag: "interactive_container",
      element_id: STREAM_ACTIONS_ELEMENT_ID,
      width: "fill", height: "auto",
      has_border: true, border_color: "grey", corner_radius: "8px",
      padding: "10px 12px 10px 12px",
      confirm: {
        title: { tag: "plain_text", content: s.confirmStopTitle },
        text: { tag: "plain_text", content: s.confirmStopText }
      },
      behaviors: [{ type: "callback", value: { action: "interrupt", chatId: state.chatId, turnId: state.turnId, threadName: state.threadName ?? "" } }],
      elements: [{
        tag: "column_set", flex_mode: "none", background_style: "default", horizontal_spacing: "default",
        columns: [
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [{
              tag: "markdown", content: buttonLabel,
              icon: { tag: "standard_icon", token: "close_outlined", color: "red" }
            }]
          },
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [greyText(buttonHint)]
          }
        ]
      }]
    };
  }

  private renderFinalActionsElement(state: TurnCardState): Record<string, unknown> {
    const s = getFeishuTurnCardStrings(this.locale);
    if (!state.actionTaken && state.fileChanges.length > 0) {
      return {
        tag: "column_set",
        element_id: STREAM_ACTIONS_ELEMENT_ID,
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
              behaviors: [{ type: "callback", value: { action: "accept_changes", chatId: state.chatId, turnId: state.turnId, threadName: state.threadName ?? "" } }],
              elements: [{
                tag: "markdown", content: s.approveChanges,
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
              confirm: {
                title: { tag: "plain_text", content: s.confirmRevertTitle },
                text: { tag: "plain_text", content: s.confirmRevertText }
              },
              behaviors: [{ type: "callback", value: { action: "revert_changes", chatId: state.chatId, turnId: state.turnId, threadName: state.threadName ?? "" } }],
              elements: [{
                tag: "markdown", content: s.revertChanges,
                icon: { tag: "standard_icon", token: "undo_outlined", color: "red" }
              }]
            }]
          }
        ]
      };
    }
    const label = !state.actionTaken && state.fileChanges.length === 0
      ? s.doneNoFileChanges
      : state.actionTaken === "accepted" ? s.actionAccepted
        : state.actionTaken === "reverted" ? s.actionReverted
          : state.actionTaken === "interrupting" ? s.actionInterrupting
          : state.actionTaken === "interrupted" ? s.actionInterrupted
            : s.actionProcessed;
    return {
      tag: "markdown",
      element_id: STREAM_ACTIONS_ELEMENT_ID,
      content: label
    };
  }

  private renderStreamingCard(state: TurnCardState): Record<string, unknown> {
    const s = getFeishuTurnCardStrings(this.locale);
    const tokenText = toTokenText(state.tokenUsage);
    const headerTags: Record<string, unknown>[] = [
      { tag: "text_tag", text: { tag: "plain_text", content: s.statusRunning }, color: "blue" }
    ];
    if (tokenText !== "-") {
      headerTags.push({ tag: "text_tag", text: { tag: "plain_text", content: `${tokenText} tok` }, color: "neutral" });
    }
    const modeLabel = state.turnMode === "plan" ? s.planMode : s.agentMode;
    return {
      schema: "2.0",
      config: {
        width_mode: "fill",
        update_multi: true,
        streaming_mode: true,
        summary: { content: "" },
        streaming_config: {
          print_frequency_ms: { default: 70, android: 70, ios: 70, pc: 70 },
          print_step: { default: 1, android: 1, ios: 1, pc: 1 },
          print_strategy: "fast"
        }
      },
      header: {
        title: { tag: "plain_text", content: `${modeLabel} ⏳` },
        subtitle: {
          tag: "plain_text",
          content: [
            formatThreadNameLabel(state.threadName, this.locale),
            state.turnNumber ? `turn-${state.turnNumber}` : null,
            state.backendName || null,
            state.modelName || null
          ].filter(Boolean).join(" · ")
        },
        icon: { tag: "standard_icon", token: "loading_outlined", color: "blue" },
        text_tag_list: headerTags,
        template: "turquoise"
      },
      body: {
        direction: "vertical",
        vertical_spacing: "8px",
        padding: "4px 12px 12px 12px",
        elements: [
          { tag: "markdown", content: this.renderStreamingMessage(state), element_id: STREAM_MSG_ELEMENT_ID },
          { tag: "markdown", content: this.renderStreamingThinking(state), element_id: STREAM_THINK_ELEMENT_ID },
          { tag: "markdown", content: this.renderStreamingProgress(state), element_id: STREAM_PROGRESS_ELEMENT_ID },
          { tag: "markdown", content: this.renderStreamingTools(state), element_id: STREAM_TOOLS_ELEMENT_ID },
          { tag: "markdown", content: this.renderStreamingFooter(state), element_id: STREAM_FOOTER_ELEMENT_ID },
          this.renderStreamingInterruptButton(state)
        ]
      }
    };
  }

  // ── Sub-page Rendering ──────────────────────────────────────────────────

  /** Render paginated file changes detail card (replaces turn card in-place). */
  renderFileChangesCard(state: TurnCardState, page: number): Record<string, unknown> {
    const s = getFeishuTurnCardStrings(this.locale);
    const PAGE_SIZE = 30;
    const allSegments = this.collectFileSegments(state);
    const totalPages = Math.max(1, Math.ceil(allSegments.length / PAGE_SIZE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const pageSegments = allSegments.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
    const { totalFiles, totalAdd, totalDel } = computeFileStats(state.fileChanges);

    const elements: Record<string, unknown>[] = [];

    for (const seg of pageSegments) {
      if (!seg.content.trim()) continue;
      const dtag = seg.status === "new" ? "NEW" : seg.status === "deleted" ? "DEL" : "MOD";
      const truncated = seg.content.slice(0, 1500);
      elements.push({
        tag: "collapsible_panel",
        expanded: false,
        header: {
          title: { tag: "markdown", content: `${seg.file}  \`[${dtag} +${seg.additions}/-${seg.deletions}]\`` },
          icon: { tag: "standard_icon", token: "code_outlined", color: "grey", size: "16px 16px" },
          icon_position: "follow_text", icon_expanded_angle: -180
        },
        background_color: "grey",
        vertical_spacing: "2px",
        elements: [{ tag: "markdown", content: "```diff\n" + truncated + "\n```" }]
      });
    }

    // Pagination
    if (totalPages > 1) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
        columns: [
          {
            tag: "column", width: "auto", vertical_align: "center",
            elements: [{
              tag: "button", text: { tag: "plain_text", content: s.previousPage },
              icon: { tag: "standard_icon", token: "arrow-left_outlined" },
              type: "default", size: "small", disabled: safePage <= 0,
              behaviors: [{ type: "callback", value: { action: "file_changes_page", chatId: state.chatId, turnId: state.turnId, page: safePage - 1 } }]
            }]
          },
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [greyText(`${safePage + 1} / ${totalPages}`)]
          },
          {
            tag: "column", width: "auto", vertical_align: "center",
            elements: [{
              tag: "button", text: { tag: "plain_text", content: s.nextPage },
              type: "default", size: "small", disabled: safePage >= totalPages - 1,
              behaviors: [{ type: "callback", value: { action: "file_changes_page", chatId: state.chatId, turnId: state.turnId, page: safePage + 1 } }]
            }]
          }
        ]
      });
    }

    // Back button
    elements.push({ tag: "hr" });
    elements.push({
      tag: "interactive_container",
      width: "fill", height: "auto",
      has_border: true, border_color: "grey", corner_radius: "8px",
      padding: "10px 12px 10px 12px",
      behaviors: [{ type: "callback", value: { action: "file_changes_back", chatId: state.chatId, turnId: state.turnId } }],
      elements: [{
        tag: "markdown", content: s.backToTurnCard,
        icon: { tag: "standard_icon", token: "arrow-left_outlined", color: "grey" }
      }]
    });

    return {
      schema: "2.0",
      config: { width_mode: "fill", update_multi: true },
      header: {
        title: { tag: "plain_text", content: s.fileChangesTitle },
        subtitle: {
          tag: "plain_text",
          content: [formatThreadNameLabel(state.threadName, this.locale), state.turnNumber ? `turn-${state.turnNumber}` : null].filter(Boolean).join(" · ")
        },
        icon: { tag: "standard_icon", token: "code_outlined", color: "turquoise" },
        text_tag_list: [
          { tag: "text_tag", text: { tag: "plain_text", content: s.fileChanges(totalFiles) }, color: "turquoise" },
          { tag: "text_tag", text: { tag: "plain_text", content: `+${totalAdd} / -${totalDel}` }, color: "neutral" }
        ],
        template: "turquoise"
      },
      body: {
        direction: "vertical",
        vertical_spacing: "4px",
        padding: "4px 12px 12px 12px",
        elements
      }
    };
  }

  /** Render paginated tool progress detail card (replaces turn card in-place). */
  renderToolProgressCard(state: TurnCardState, page: number): Record<string, unknown> {
    const s = getFeishuTurnCardStrings(this.locale);
    const TOOLS_PER_PAGE = 30;
    const OUTPUTS_PER_PAGE = 15;

    const filteredTools = state.tools.filter((t) =>
      !t.includes(s.applyPatch) && !t.includes(s.patchPrefix(""))
    );
    const toolOutputLabels = new Set([...state.toolOutputs.values()].map((v) => v.command));
    const displayTools = filteredTools.filter((t) => {
      for (const label of toolOutputLabels) {
        if (t.includes(label)) return false;
      }
      return true;
    });
    const allOutputs = [...state.toolOutputs.entries()].filter(([, v]) => v.output.trim());

    // Paginate: tools and outputs together
    const totalItems = displayTools.length + allOutputs.length;
    const itemsPerPage = TOOLS_PER_PAGE + OUTPUTS_PER_PAGE;
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    const elements: Record<string, unknown>[] = [];

    // Tools for this page
    const toolStart = safePage * TOOLS_PER_PAGE;
    const pageTools = displayTools.slice(toolStart, toolStart + TOOLS_PER_PAGE);
    if (pageTools.length > 0) {
      const sanitized = pageTools.map((t) => {
        const firstLine = t.split("\n")[0]!;
        return firstLine.replace(
          /(<\/font>)\s+(.+)$/,
          (_, closing: string, cmd: string) => `${closing} \`${cmd}\``
        );
      });
      elements.push({ tag: "markdown", content: sanitized.join("\n") });
    }

    // Outputs for this page
    const outputStart = safePage * OUTPUTS_PER_PAGE;
    const pageOutputs = allOutputs.slice(outputStart, outputStart + OUTPUTS_PER_PAGE);
    for (const [, { command, output }] of pageOutputs) {
      elements.push({
        tag: "collapsible_panel",
        expanded: false,
        header: {
          title: { tag: "markdown", content: `**${command}**` },
          icon: { tag: "standard_icon", token: "command_outlined", color: "grey", size: "16px 16px" },
          icon_position: "follow_text", icon_expanded_angle: -180
        },
        background_color: "grey",
        vertical_spacing: "2px",
        elements: [{ tag: "markdown", content: "```\n" + output.slice(-2000) + "\n```" }]
      });
    }

    // Pagination
    if (totalPages > 1) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "column_set", flex_mode: "none", horizontal_spacing: "default",
        columns: [
          {
            tag: "column", width: "auto", vertical_align: "center",
            elements: [{
              tag: "button", text: { tag: "plain_text", content: s.previousPage },
              icon: { tag: "standard_icon", token: "arrow-left_outlined" },
              type: "default", size: "small", disabled: safePage <= 0,
              behaviors: [{ type: "callback", value: { action: "tool_progress_page", chatId: state.chatId, turnId: state.turnId, page: safePage - 1 } }]
            }]
          },
          {
            tag: "column", width: "weighted", weight: 1, vertical_align: "center",
            elements: [greyText(`${safePage + 1} / ${totalPages}`)]
          },
          {
            tag: "column", width: "auto", vertical_align: "center",
            elements: [{
              tag: "button", text: { tag: "plain_text", content: s.nextPage },
              type: "default", size: "small", disabled: safePage >= totalPages - 1,
              behaviors: [{ type: "callback", value: { action: "tool_progress_page", chatId: state.chatId, turnId: state.turnId, page: safePage + 1 } }]
            }]
          }
        ]
      });
    }

    // Back button
    elements.push({ tag: "hr" });
    elements.push({
      tag: "interactive_container",
      width: "fill", height: "auto",
      has_border: true, border_color: "grey", corner_radius: "8px",
      padding: "10px 12px 10px 12px",
      behaviors: [{ type: "callback", value: { action: "tool_progress_back", chatId: state.chatId, turnId: state.turnId } }],
      elements: [{
        tag: "markdown", content: s.backToTurnCard,
        icon: { tag: "standard_icon", token: "arrow-left_outlined", color: "grey" }
      }]
    });

    const { stepCount } = computeToolStats(state, this.locale);
    return {
      schema: "2.0",
      config: { width_mode: "fill", update_multi: true },
      header: {
        title: { tag: "plain_text", content: s.executionProcessTitle },
        subtitle: {
          tag: "plain_text",
          content: [formatThreadNameLabel(state.threadName, this.locale), state.turnNumber ? `turn-${state.turnNumber}` : null].filter(Boolean).join(" · ")
        },
        icon: { tag: "standard_icon", token: "list-check_outlined", color: "blue" },
        text_tag_list: [
          { tag: "text_tag", text: { tag: "plain_text", content: s.stepCount(stepCount) }, color: "blue" }
        ],
        template: "blue"
      },
      body: {
        direction: "vertical",
        vertical_spacing: "4px",
        padding: "4px 12px 12px 12px",
        elements
      }
    };
  }

  // ── State Recovery (public) ─────────────────────────────────────────────

  /** 统一入口预热后的交互缓存；不再承担历史恢复职责。 */
  getCachedState(chatId: string, turnId: string): TurnCardState | null {
    const key = keyOf(chatId, turnId);
    return this.cardState.get(key) ?? null;
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /** Collect all per-file diff segments from state (deduplicated). */
  private collectFileSegments(state: TurnCardState): Array<{ file: string; content: string; status: string; additions: number; deletions: number }> {
    const seen = new Set<string>();
    const uniqueFileChanges = state.fileChanges.filter((change) => {
      const key = change.filesChanged.sort().join(",");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const segments: Array<{ file: string; content: string; status: string; additions: number; deletions: number }> = [];
    for (const change of uniqueFileChanges) {
      const perFileSegments = change.diffSegments ?? [];
      for (const seg of perFileSegments) {
        segments.push(seg);
      }
    }
    return segments;
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────

function computeFileStats(fileChanges: TurnCardState["fileChanges"]): { totalFiles: number; totalAdd: number; totalDel: number } {
  const seen = new Set<string>();
  let totalFiles = 0, totalAdd = 0, totalDel = 0;
  for (const change of fileChanges) {
    const key = change.filesChanged.sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const diffFiles = change.diffFiles ?? [];
    totalFiles += diffFiles.length;
    totalAdd += diffFiles.reduce((s, f) => s + f.additions, 0);
    totalDel += diffFiles.reduce((s, f) => s + f.deletions, 0);
  }
  return { totalFiles, totalAdd, totalDel };
}

function computeToolStats(
  state: TurnCardState,
  locale: AppLocale = DEFAULT_APP_LOCALE
): { stepCount: number } {
  const s = getFeishuTurnCardStrings(locale);
  const filteredTools = state.tools.filter((t) =>
    !t.includes(s.applyPatch) && !t.includes(s.patchPrefix(""))
  );
  const toolOutputLabels = new Set([...state.toolOutputs.values()].map((v) => v.command));
  const displayTools = filteredTools.filter((t) => {
    for (const label of toolOutputLabels) {
      if (t.includes(label)) return false;
    }
    return true;
  });
  const outputCount = [...state.toolOutputs.values()].filter((v) => v.output.trim()).length;
  return { stepCount: displayTools.length + outputCount };
}
