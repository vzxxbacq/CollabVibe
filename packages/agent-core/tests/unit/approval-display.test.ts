import { describe, expect, it } from "vitest";

import { buildApprovalDisplay, looksOpaqueApprovalValue, safeApprovalText, summarizeCommand } from "../../src/approval-display";

describe("approval-display", () => {
    it("filters opaque ids from display fields and falls back to safe defaults", () => {
        const result = buildApprovalDisplay({
            approvalType: "command_exec",
            requestId: "019d158a-9f76-7c11-a130-3973614ab254",
            callId: "call-1",
            reason: "network access required",
            displayNameCandidates: ["019d158a-9f76-7c11-a130-3973614ab254", "call-1"],
            summaryCandidates: ["call-1", "npm install"],
            fallbackDisplayName: "Run shell command",
            fallbackDescription: "command execution"
        });

        expect(result.displayName).toBe("Run shell command");
        expect(result.summary).toBe("npm install");
        expect(result.description).toBe("Command approval: npm install");
    });

    it("builds file change approval display with safe files and reason-first description", () => {
        const result = buildApprovalDisplay({
            approvalType: "file_change",
            requestId: "req-1",
            callId: "call-2",
            reason: "needs write access to config",
            files: ["src/config.ts", "req-1", "019d158a-9f76-7c11-a130-3973614ab254"],
            displayNameCandidates: ["Approve file changes"],
            summaryCandidates: ["src/config.ts, req-1"],
            fallbackDescription: "File change approval"
        });

        expect(result.displayName).toBe("Approve file changes");
        expect(result.summary).toBe("src/config.ts, req-1");
        expect(result.files).toEqual(["src/config.ts"]);
        expect(result.description).toBe("needs write access to config");
    });

    it("preserves command and cwd while using fallback description when summary is unavailable", () => {
        const result = buildApprovalDisplay({
            approvalType: "command_exec",
            requestId: "req-2",
            callId: "call-3",
            reason: "sandbox escalation",
            cwd: "/repo",
            command: ["bash", "-lc", "echo hello"],
            fallbackDisplayName: "Run shell command",
            fallbackDescription: "command execution"
        });

        expect(result.displayName).toBe("Run shell command");
        expect(result.summary).toBeUndefined();
        expect(result.command).toEqual(["bash", "-lc", "echo hello"]);
        expect(result.cwd).toBe("/repo");
        expect(result.description).toBe("Command approval: sandbox escalation");
    });

    it("exposes low-level opaque filtering helpers", () => {
        expect(looksOpaqueApprovalValue("019d158a-9f76-7c11-a130-3973614ab254")).toBe(true);
        expect(looksOpaqueApprovalValue("call-1", ["call-1"])).toBe(true);
        expect(safeApprovalText("npm install", ["call-1"])).toBe("npm install");
        expect(safeApprovalText("call-1", ["call-1"])).toBeUndefined();
        expect(summarizeCommand(["npm", "install"])).toBe("npm install");
    });
});
