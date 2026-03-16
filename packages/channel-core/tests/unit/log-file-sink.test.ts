import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createFileLogSink, multiSink } from "../../src/log-file-sink";
import type { LogEntry } from "../../src/logger";

function makeEntry(overrides?: Partial<LogEntry>): LogEntry {
    return {
        level: 30,
        time: Date.now(),
        name: "test",
        msg: "hello",
        ...overrides
    };
}

describe("FileLogSink", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should create log directory and write JSONL entries", () => {
        const logDir = path.join(tmpDir, "logs");
        const sink = createFileLogSink({ dir: logDir, baseName: "app" });

        sink(makeEntry({ msg: "first" }));
        sink(makeEntry({ msg: "second" }));

        const logFile = path.join(logDir, "app.log");
        expect(fs.existsSync(logFile)).toBe(true);

        const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
        expect(lines).toHaveLength(2);

        const parsed = JSON.parse(lines[0]) as LogEntry;
        expect(parsed.msg).toBe("first");
        expect(parsed.level).toBe(30);
        expect(parsed.name).toBe("test");
    });

    it("should rotate files when maxSizeBytes is exceeded", () => {
        const sink = createFileLogSink({
            dir: tmpDir,
            maxSizeBytes: 100, // Very small — triggers rotation quickly
            maxFiles: 2,
            baseName: "app"
        });

        // Write enough entries to exceed 100 bytes
        for (let i = 0; i < 10; i++) {
            sink(makeEntry({ msg: `message-${i}-padding-to-exceed-limit` }));
        }

        // Should have rotated files
        const files = fs.readdirSync(tmpDir).filter(f => f.startsWith("app"));
        expect(files.length).toBeGreaterThanOrEqual(2);

        // app.log should exist (current)
        expect(files).toContain("app.log");
        // At least one rotated file
        expect(files.some(f => f.match(/app\.\d+\.log/))).toBe(true);
    });

    it("should limit rotated files to maxFiles", () => {
        const sink = createFileLogSink({
            dir: tmpDir,
            maxSizeBytes: 50,
            maxFiles: 2,
            baseName: "app"
        });

        for (let i = 0; i < 30; i++) {
            sink(makeEntry({ msg: `msg-${i}-padding-for-rotation-test` }));
        }

        const files = fs.readdirSync(tmpDir).filter(f => f.startsWith("app"));
        // Should not have more than maxFiles + 1 (current)
        expect(files.length).toBeLessThanOrEqual(3); // app.log + app.1.log + app.2.log
    });

    it("should return noop sink if directory creation fails", () => {
        // Use a path that can't be created (file as parent)
        const blockingFile = path.join(tmpDir, "blocker");
        fs.writeFileSync(blockingFile, "x");
        const sink = createFileLogSink({ dir: path.join(blockingFile, "impossible") });

        // Should not throw
        expect(() => sink(makeEntry())).not.toThrow();
    });
});

describe("multiSink", () => {
    it("should fan out to all sinks", () => {
        const results: string[] = [];
        const sink1 = (e: LogEntry) => results.push(`s1:${e.msg}`);
        const sink2 = (e: LogEntry) => results.push(`s2:${e.msg}`);

        const combined = multiSink(sink1, sink2);
        combined(makeEntry({ msg: "test" }));

        expect(results).toEqual(["s1:test", "s2:test"]);
    });

    it("should not let one sink failure affect others", () => {
        const results: string[] = [];
        const failing = () => { throw new Error("boom"); };
        const working = (e: LogEntry) => results.push(e.msg);

        const combined = multiSink(failing, working);
        combined(makeEntry({ msg: "ok" }));

        expect(results).toEqual(["ok"]);
    });
});
