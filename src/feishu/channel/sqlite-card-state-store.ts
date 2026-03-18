import type { FeishuCardStateStore, PersistedCardState } from "./feishu-card-state-store";

type DatabaseLike = {
    exec(sql: string): void;
    prepare(sql: string): {
        run(...params: unknown[]): void;
        get(...params: unknown[]): Record<string, unknown> | undefined;
        all(...params: unknown[]): Array<Record<string, unknown>>;
    };
};

/**
 * SQLite 实现 — 持久化飞书卡片状态。
 * 表 feishu_card_state(key TEXT PK, data TEXT, created_at INTEGER)
 */
export class SqliteCardStateStore implements FeishuCardStateStore {
    constructor(private readonly db: DatabaseLike) {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS feishu_card_state (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    }

    save(key: string, data: PersistedCardState): void {
        this.db.prepare(
            "INSERT OR REPLACE INTO feishu_card_state (key, data, created_at) VALUES (?, ?, ?)"
        ).run(key, JSON.stringify(data), Math.floor(Date.now() / 1000));
    }

    load(key: string): PersistedCardState | null {
        const row = this.db.prepare("SELECT data FROM feishu_card_state WHERE key = ?").get(key);
        if (!row || typeof row.data !== "string") {
            return null;
        }
        try {
            return JSON.parse(row.data) as PersistedCardState;
        } catch {
            return null;
        }
    }

    remove(key: string): void {
        this.db.prepare("DELETE FROM feishu_card_state WHERE key = ?").run(key);
    }

    listByChat(chatId: string, limit = 50): PersistedCardState[] {
        const rows = this.db.prepare(
            "SELECT data FROM feishu_card_state WHERE json_extract(data, '$.chatId') = ? ORDER BY created_at DESC LIMIT ?"
        ).all(chatId, limit);
        return rows.flatMap((row) => {
            try { return [JSON.parse(String(row.data)) as PersistedCardState]; }
            catch { return []; }
        });
    }

    getLatestTurnNumber(chatId: string, threadName: string): number | null {
        const row = this.db.prepare(
            `SELECT json_extract(data, '$.turnNumber') AS turn_number
               FROM feishu_card_state
              WHERE json_extract(data, '$.chatId') = ?
                AND json_extract(data, '$.threadName') = ?
                AND json_extract(data, '$.turnNumber') IS NOT NULL
              ORDER BY CAST(json_extract(data, '$.turnNumber') AS INTEGER) DESC, created_at DESC
              LIMIT 1`
        ).get(chatId, threadName);
        const value = row?.turn_number;
        return typeof value === "number" ? value : (typeof value === "string" && value !== "" ? Number(value) : null);
    }
}

