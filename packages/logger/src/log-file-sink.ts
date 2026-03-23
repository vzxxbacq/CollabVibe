// ─────────────────────────────────────────────────────────────────────────────
// JSONL file sink — append-only, size-based rotation
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "node:fs";
import * as path from "node:path";
import type { LogEntry } from "./logger";

export interface FileLogSinkOptions {
    /** 日志目录（必填，由 caller 从 config.dataDir 派生） */
    dir: string;
    /** 单文件最大字节数，默认 10MB */
    maxSizeBytes?: number;
    /** 保留历史文件数，默认 5 */
    maxFiles?: number;
    /** 日志文件名（不含扩展名），默认 "app" */
    baseName?: string;
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_FILES = 5;
const DEFAULT_BASE_NAME = "app";

/**
 * 创建一个 JSONL 文件 sink。
 *
 * 每条日志以 JSON 单行写入，格式与 pino 原生输出一致。
 * 超过 maxSizeBytes 时触发轮转：app.log → app.1.log → app.2.log → ...
 *
 * 环境变量覆盖：LOG_MAX_SIZE, LOG_MAX_FILES
 */
export function createFileLogSink(options: FileLogSinkOptions): (entry: LogEntry) => void {
    const dir = process.env.LOG_DIR || options.dir;
    const maxSize = Number(process.env.LOG_MAX_SIZE) || options?.maxSizeBytes || DEFAULT_MAX_SIZE;
    const maxFiles = Number(process.env.LOG_MAX_FILES) || options?.maxFiles || DEFAULT_MAX_FILES;
    const baseName = options?.baseName || DEFAULT_BASE_NAME;
    const ext = ".log";

    const currentPath = path.join(dir, `${baseName}${ext}`);

    // 确保目录存在
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch {
        // 如果无法创建目录，返回 noop sink
        return () => { };
    }

    let currentSize = 0;
    try {
        const stat = fs.statSync(currentPath);
        currentSize = stat.size;
    } catch {
        // 文件不存在 — 从 0 开始
    }

    function rotate(): void {
        try {
            // 删除最旧的文件
            const oldest = path.join(dir, `${baseName}.${maxFiles}${ext}`);
            try { fs.unlinkSync(oldest); } catch { /* ok */ }

            // 依次重命名 N-1 → N
            for (let i = maxFiles - 1; i >= 1; i--) {
                const src = path.join(dir, `${baseName}.${i}${ext}`);
                const dst = path.join(dir, `${baseName}.${i + 1}${ext}`);
                try { fs.renameSync(src, dst); } catch { /* ok */ }
            }

            // 当前文件 → .1
            const first = path.join(dir, `${baseName}.1${ext}`);
            try { fs.renameSync(currentPath, first); } catch { /* ok */ }

            currentSize = 0;
        } catch {
            // 轮转失败不阻塞日志写入
        }
    }

    return (entry: LogEntry) => {
        try {
            const line = JSON.stringify(entry) + "\n";
            const bytes = Buffer.byteLength(line, "utf-8");

            if (currentSize + bytes > maxSize) {
                rotate();
            }

            fs.appendFileSync(currentPath, line, "utf-8");
            currentSize += bytes;
        } catch {
            // 文件写入失败不应阻塞应用
        }
    };
}

/**
 * 组合多个 sink 为一个。
 */
export function multiSink(...sinks: Array<(entry: LogEntry) => void>): (entry: LogEntry) => void {
    return (entry: LogEntry) => {
        for (const sink of sinks) {
            try {
                sink(entry);
            } catch {
                // 单个 sink 失败不影响其他
            }
        }
    };
}

/**
 * Wrap a sink with a predicate filter.
 * Entries that do not match are ignored.
 */
export function createFilteredSink(
    sink: (entry: LogEntry) => void,
    predicate: (entry: LogEntry) => boolean
): (entry: LogEntry) => void {
    return (entry: LogEntry) => {
        if (!predicate(entry)) return;
        sink(entry);
    };
}
