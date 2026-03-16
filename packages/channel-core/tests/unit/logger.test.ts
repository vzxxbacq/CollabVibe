import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    createLogger,
    setLogLevel,
    setLogSink,
    resetLogSink,
    getLogLevel,
    type LogEntry,
    type Logger,
    LOG_LEVEL_VALUES
} from "../../src/logger";

describe("Logger", () => {
    let captured: LogEntry[];
    const captureSink = (entry: LogEntry) => { captured.push(entry); };

    beforeEach(() => {
        captured = [];
        setLogSink(captureSink);
        setLogLevel("trace");
    });

    afterEach(() => {
        resetLogSink();
        setLogLevel("info");
    });

    it("should emit log entries with correct level values", () => {
        const log = createLogger("test");
        log.trace("t");
        log.debug("d");
        log.info("i");
        log.warn("w");
        log.error("e");
        log.fatal("f");

        expect(captured).toHaveLength(6);
        expect(captured.map(e => e.level)).toEqual([10, 20, 30, 40, 50, 60]);
        expect(captured.every(e => e.name === "test")).toBe(true);
    });

    it("should respect log level filtering", () => {
        setLogLevel("warn");
        const log = createLogger("test");

        log.trace("should be filtered");
        log.debug("should be filtered");
        log.info("should be filtered");
        log.warn("should pass");
        log.error("should pass");
        log.fatal("should pass");

        expect(captured).toHaveLength(3);
        expect(captured.map(e => e.msg)).toEqual(["should pass", "should pass", "should pass"]);
    });

    it("should support pino-style (obj, msg) call signature", () => {
        const log = createLogger("test");
        log.info({ chatId: "c1", turnId: "t1" }, "creating card");

        expect(captured).toHaveLength(1);
        expect(captured[0].msg).toBe("creating card");
        expect(captured[0].chatId).toBe("c1");
        expect(captured[0].turnId).toBe("t1");
    });

    it("should support pino-style (msg) call signature", () => {
        const log = createLogger("test");
        log.info("simple message");

        expect(captured).toHaveLength(1);
        expect(captured[0].msg).toBe("simple message");
    });

    it("should support child() with merged bindings", () => {
        const parent = createLogger("parent");
        const child = parent.child({ chatId: "c1" });

        child.info({ turnId: "t1" }, "child msg");

        expect(captured).toHaveLength(1);
        const entry = captured[0];
        expect(entry.name).toBe("parent");
        expect(entry.chatId).toBe("c1");
        expect(entry.turnId).toBe("t1");
        expect(entry.msg).toBe("child msg");
    });

    it("child bindings should be overridable by call-site context", () => {
        const log = createLogger("test").child({ env: "prod" });
        log.info({ env: "test" }, "override");

        expect(captured[0].env).toBe("test"); // call-site wins
    });

    it("should include timestamp in entries", () => {
        const log = createLogger("test");
        log.info("timestamped");
        expect(captured[0].time).toBeTypeOf("number");
        expect(captured[0].time).toBeGreaterThan(0);
    });

    it("noop sink should suppress all output", () => {
        setLogSink(() => { });
        const log = createLogger("test");
        log.error("should be silent");
        // No error thrown, no output — just verifying it works
    });

    describe("LOG_LEVEL_VALUES", () => {
        it("should match pino numeric levels", () => {
            expect(LOG_LEVEL_VALUES.trace).toBe(10);
            expect(LOG_LEVEL_VALUES.debug).toBe(20);
            expect(LOG_LEVEL_VALUES.info).toBe(30);
            expect(LOG_LEVEL_VALUES.warn).toBe(40);
            expect(LOG_LEVEL_VALUES.error).toBe(50);
            expect(LOG_LEVEL_VALUES.fatal).toBe(60);
        });
    });

    describe("getLogLevel / setLogLevel", () => {
        it("should allow reading and setting global level", () => {
            setLogLevel("error");
            expect(getLogLevel()).toBe("error");
            setLogLevel("info");
            expect(getLogLevel()).toBe("info");
        });
    });
});
