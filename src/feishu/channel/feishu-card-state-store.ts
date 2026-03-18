/** 飞书层卡片状态持久化接口 — 用于完整 Turn Card 存储和历史查询 */
export interface FeishuCardStateStore {
    save(key: string, data: PersistedCardState): void;
    load(key: string): PersistedCardState | null;
    remove(key: string): void;
    /** 查询指定 chat 的所有持久化卡片状态，按创建时间降序 */
    listByChat(chatId: string, limit?: number): PersistedCardState[];
    /** 查询指定 thread 最近一次已持久化的 human-readable turn number。 */
    getLatestTurnNumber?(chatId: string, threadName: string): number | null;
}

/** 持久化的卡片状态 — 保存完整 TurnCardState 供随时调出 */
export interface PersistedCardState {
    chatId: string;
    turnId: string;
    cardToken: string;
    status?: "running" | "completed" | "aborted" | "failed";
    threadName?: string;
    /** Per-turn human-readable number */
    turnNumber?: number;
    message: string;
    promptSummary?: string;
    /** Thinking/reasoning content — persisted for card action recovery */
    thinking?: string;
    /** Tool progress labels — persisted for card action recovery */
    tools?: string[];
    /** Tool outputs (serializable array form of Map) — persisted for card action recovery */
    toolOutputs?: Array<{ callId: string; command: string; output: string }>;
    /** Structured plan updates from update_plan tool */
    planState?: {
        explanation?: string;
        items: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>;
    };
    fileChanges: Array<{
        filesChanged: string[];
        diffSummary: string;
        stats?: { additions: number; deletions: number };
    }>;
    tokenUsage?: { input: number; output: number };
    footer: string;
    statusDetail?: string;
    /** Per-turn backend name (e.g. "codex") — persisted for card action recovery */
    backendName?: string;
    /** Per-turn model name (e.g. "gpt-5.3-codex") — persisted for card action recovery */
    modelName?: string;
    /** Sub-agent note (e.g. "子 agent-xxx 工作中") */
    agentNote?: string;
    /** User action taken on the card (accept/revert/interrupt) */
    actionTaken?: "accepted" | "reverted" | "interrupted";
    /** Turn mode — "plan" for plan mode, undefined for default agent mode */
    turnMode?: "plan";
}
