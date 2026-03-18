// ─────────────────────────────────────────────────────────────────────────────
// Logger — pino-compatible lightweight logger
// ─────────────────────────────────────────────────────────────────────────────
//
// 设计目标：
//   1. 接口完全对齐 pino（LogFn 两种签名 + child(bindings)）
//   2. 零外部依赖
//   3. 测试可通过 setLogSink() 全局替换 sink
//   4. 生产环境同时输出 console + JSONL 文件
//   5. 未来如需迁移 pino，只改此文件
//
// pino level 数值对照:
//   trace=10, debug=20, info=30, warn=40, error=50, fatal=60
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/** pino-compatible level values */
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60
};

/**
 * pino-compatible LogFn — 支持两种调用方式：
 *   log.info("message")
 *   log.info({ chatId: "xxx" }, "message")
 */
export interface LogFn {
    (msg: string, ...args: unknown[]): void;
    (obj: Record<string, unknown>, msg?: string, ...args: unknown[]): void;
}

/** pino-compatible Logger interface */
export interface Logger {
    trace: LogFn;
    debug: LogFn;
    info: LogFn;
    warn: LogFn;
    error: LogFn;
    fatal: LogFn;
    child(bindings: Record<string, unknown>): Logger;
    level: LogLevel;
}

/** Structured log entry — JSONL 持久化的单行结构 */
export interface LogEntry {
    level: number;
    time: number;
    name: string;
    msg: string;
    [key: string]: unknown;
}

// ── 全局配置 ─────────────────────────────────────────────────────────────

let globalLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
let moduleLevels = parseModuleLevels(process.env.LOG_MODULE_LEVELS);
const REDACTED = "***";
const SENSITIVE_KEY_RE = /(token|secret|password|authorization|api[_-]?key|cookie)/i;
const SENSITIVE_VALUE_RE = /(bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|ghp_[a-z0-9]+)/i;

function isLogLevel(value: string): value is LogLevel {
    return value in LOG_LEVEL_VALUES;
}

function parseModuleLevels(raw?: string): Record<string, LogLevel> {
    if (!raw) return {};
    return raw.split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce<Record<string, LogLevel>>((acc, part) => {
            const [name, level] = part.split("=", 2).map((value) => value?.trim() ?? "");
            if (name && level && isLogLevel(level)) {
                acc[name] = level;
            }
            return acc;
        }, {});
}

export function setLogLevel(level: LogLevel): void {
    globalLevel = level;
}

export function getLogLevel(): LogLevel {
    return globalLevel;
}

export function setModuleLogLevels(levels: Record<string, LogLevel>): void {
    moduleLevels = { ...levels };
}

export function getModuleLogLevels(): Record<string, LogLevel> {
    return { ...moduleLevels };
}

export function getEffectiveLogLevel(name: string): LogLevel {
    return moduleLevels[name] ?? globalLevel;
}

function redactString(value: string): string {
    if (!SENSITIVE_VALUE_RE.test(value)) return value;
    return value.replace(SENSITIVE_VALUE_RE, REDACTED);
}

function sanitizeLogValue(key: string, value: unknown, depth = 0): unknown {
    if (depth > 4) return "[truncated]";
    if (SENSITIVE_KEY_RE.test(key)) {
        if (typeof value === "string" && value.length <= 8) return REDACTED;
        if (Array.isArray(value)) return value.map(() => REDACTED);
        if (value && typeof value === "object") return REDACTED;
        return REDACTED;
    }
    if (typeof value === "string") return redactString(value);
    if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(key, item, depth + 1));
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        out[childKey] = sanitizeLogValue(childKey, childValue, depth + 1);
    }
    return out;
}

function sanitizeBindings(input?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!input) return input;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        out[key] = sanitizeLogValue(key, value);
    }
    return out;
}

// ── Sink ─────────────────────────────────────────────────────────────────

/** 默认 console sink — 人类可读格式 */
function defaultConsoleSink(entry: LogEntry): void {
    const { level, name, msg, time, ...rest } = entry;
    const line = `[${new Date(time).toISOString()}] [${name}] ${msg}`;
    const extra = Object.keys(rest).length > 0 ? rest : undefined;
    if (level >= LOG_LEVEL_VALUES.error) {
        extra ? console.error(line, extra) : console.error(line);
    } else if (level >= LOG_LEVEL_VALUES.warn) {
        extra ? console.warn(line, extra) : console.warn(line);
    } else {
        extra ? console.log(line, extra) : console.log(line);
    }
}

let globalSink: (entry: LogEntry) => void = defaultConsoleSink;

/** 替换全局 log sink（测试环境用 noop，生产环境用 multi-sink） */
export function setLogSink(sink: (entry: LogEntry) => void): void {
    globalSink = sink;
}

/** 获取当前 sink（用于 multi-sink 组合） */
export function getLogSink(): (entry: LogEntry) => void {
    return globalSink;
}

/** 重置为默认 console sink */
export function resetLogSink(): void {
    globalSink = defaultConsoleSink;
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * 创建一个 pino 兼容的 Logger 实例。
 *
 * @param name - 日志标签，如 "card", "handler", "server"
 * @param bindings - 附加上下文，child() 会合并
 */
export function createLogger(name: string, bindings?: Record<string, unknown>): Logger {
    const safeBindings = sanitizeBindings(bindings);
    const emit = (levelName: LogLevel, firstArg: unknown, rest: unknown[]) => {
        const effectiveLevel = getEffectiveLogLevel(name);
        if (LOG_LEVEL_VALUES[levelName] < LOG_LEVEL_VALUES[effectiveLevel]) return;

        let msg: string;
        let extra: Record<string, unknown> | undefined;

        if (typeof firstArg === "string") {
            msg = firstArg;
            // sprintf-style 插值 (简化版)
            if (rest.length > 0) {
                msg = rest.reduce<string>((s, v) => s.replace("%s", String(v)), msg);
            }
        } else if (typeof firstArg === "object" && firstArg !== null) {
            extra = sanitizeBindings(firstArg as Record<string, unknown>);
            msg = typeof rest[0] === "string" ? (rest.shift() as string) : "";
            if (rest.length > 0 && msg) {
                msg = rest.reduce<string>((s, v) => s.replace("%s", String(v)), msg);
            }
        } else {
            msg = String(firstArg ?? "");
        }

        const entry: LogEntry = {
            level: LOG_LEVEL_VALUES[levelName],
            time: Date.now(),
            name,
            msg: typeof msg === "string" ? redactString(msg) : msg,
            ...safeBindings,
            ...extra
        };

        globalSink(entry);
    };

    const makeLogFn = (levelName: LogLevel): LogFn => {
        return ((first: unknown, ...rest: unknown[]) => {
            emit(levelName, first, rest);
        }) as LogFn;
    };

    return {
        trace: makeLogFn("trace"),
        debug: makeLogFn("debug"),
        info: makeLogFn("info"),
        warn: makeLogFn("warn"),
        error: makeLogFn("error"),
        fatal: makeLogFn("fatal"),
        child: (extra: Record<string, unknown>) =>
            createLogger(name, { ...safeBindings, ...sanitizeBindings(extra) }),
        level: getEffectiveLogLevel(name)
    };
}
