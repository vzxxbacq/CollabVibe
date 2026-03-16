import { describe, expect, it } from "vitest";

import { transformEvent } from "../../../src/event-transformer";
import type { IMProgressEvent } from "../../../src/im-output";

const ctx = {
  chatId: "chat-1",
  threadId: "thr-1",
  turnId: "turn-1"
};

describe("event-transformer-full", () => {
  it("maps patch apply begin/end with target file", () => {
    const begin = transformEvent(
      {
        type: "patch_apply_begin",
        turn_id: "turn-2",
        changes: {
          "src/a.ts": {}
        }
      },
      ctx
    );
    const end = transformEvent(
      {
        type: "patch_apply_end",
        turn_id: "turn-2",
        success: false,
        stderr: "failed",
        changes: {
          "src/a.ts": {}
        }
      },
      ctx
    );

    expect(begin).toMatchObject({
      kind: "progress",
      tool: "patch_apply",
      phase: "begin",
      targetFile: "src/a.ts"
    });
    expect(end).toMatchObject({
      kind: "progress",
      tool: "patch_apply",
      phase: "end",
      status: "failed",
      targetFile: "src/a.ts"
    });
  });

  it("maps collab and elicitation events", () => {
    const collab = transformEvent(
      {
        type: "collab_agent_interaction_begin",
        receiver_thread_id: "agent-2"
      },
      ctx
    );
    const elicitation = transformEvent(
      {
        type: "elicitation_request",
        id: "elic-1",
        request: {
          message: "请选择部署环境"
        }
      },
      ctx
    );

    expect(collab).toMatchObject({
      kind: "progress",
      tool: "collab_agent",
      phase: "begin",
      agentId: "agent-2"
    });
    expect(elicitation).toEqual({
      kind: "user_input",
      threadId: "thr-1",
      turnId: "turn-1",
      callId: "elic-1",
      questions: [{ text: "请选择部署环境" }]
    });
  });

  it("maps model/context/undo/deprecation notifications", () => {
    expect(
      transformEvent(
        {
          type: "model_reroute",
          from_model: "gpt-a",
          to_model: "gpt-b"
        },
        ctx
      )
    ).toMatchObject({ kind: "notification", category: "model_reroute" });

    expect(transformEvent({ type: "context_compacted" }, ctx)).toMatchObject({
      kind: "notification",
      category: "context_compacted"
    });
    expect(transformEvent({ type: "undo_started", message: "undo..." }, ctx)).toMatchObject({
      kind: "notification",
      category: "undo_started"
    });
    expect(transformEvent({ type: "undo_completed", success: true, message: "done" }, ctx)).toMatchObject({
      kind: "notification",
      category: "undo_completed"
    });
    expect(transformEvent({ type: "deprecation_notice", summary: "old api", details: "use new api" }, ctx)).toMatchObject({
      kind: "notification",
      category: "deprecation",
      title: "old api"
    });
  });

  it("returns null for turn_diff events (no longer transformed to file_change)", () => {
    const message = transformEvent(
      {
        type: "turn_diff",
        unified_diff: [
          "diff --git a/src/a.ts b/src/a.ts",
          "--- a/src/a.ts",
          "+++ b/src/a.ts",
          "@@ -1 +1 @@",
          "-old",
          "+new"
        ].join("\n")
      },
      ctx
    );

    expect(message).toBeNull();
  });

  const streamCases: Array<{
    id: string;
    title: string;
    event: Record<string, unknown>;
    expectedKind: string;
    delta: string;
  }> = [
      {
        id: "C9-1",
        title: "maps agent_message_content_delta to content chunk",
        event: { type: "agent_message_content_delta", delta: "hello" },
        expectedKind: "content",
        delta: "hello"
      },
      {
        id: "C9-2",
        title: "maps agent_reasoning_delta to reasoning chunk",
        event: { type: "agent_reasoning_delta", delta: "think" },
        expectedKind: "reasoning",
        delta: "think"
      },
      {
        id: "C9-3",
        title: "maps reasoning_content_delta to reasoning chunk",
        event: { type: "reasoning_content_delta", delta: "analyze" },
        expectedKind: "reasoning",
        delta: "analyze"
      },
      {
        id: "C9-4",
        title: "maps reasoning_raw_content_delta to reasoning chunk",
        event: { type: "reasoning_raw_content_delta", delta: "raw-think" },
        expectedKind: "reasoning",
        delta: "raw-think"
      },
      {
        id: "C9-5",
        title: "maps plan_delta to plan chunk",
        event: { type: "plan_delta", delta: "1. do x" },
        expectedKind: "plan",
        delta: "1. do x"
      },
      {
        id: "C9-6",
        title: "maps exec_command_output_delta to tool_output chunk",
        event: { type: "exec_command_output_delta", chunk: Buffer.from("npm test output").toString("base64"), call_id: "call-1" },
        expectedKind: "tool_output",
        delta: "npm test output"
      },
      {
        id: "C9-7",
        title: "maps terminal_interaction stdin to tool_output chunk",
        event: { type: "terminal_interaction", stdin: "y", call_id: "call-2" },
        expectedKind: "tool_output",
        delta: "y"
      }
    ];

  for (const testCase of streamCases) {
    it(`[${testCase.id}] ${testCase.title}`, () => {
      const output = transformEvent(testCase.event as never, ctx);

      expect(output).toMatchObject({
        kind: testCase.expectedKind,
        turnId: "turn-1",
        delta: testCase.delta
      });
    });
  }

  const progressCases: Array<{
    id: string;
    title: string;
    event: Record<string, unknown>;
    tool: string;
    phase: "begin" | "end";
    special?: (message: IMProgressEvent) => void;
  }> = [
      {
        id: "C9-8",
        title: "maps exec_command_begin to progress begin with command label",
        event: { type: "exec_command_begin", command: ["npm", "test"] },
        tool: "exec_command",
        phase: "begin",
        special: (message) => expect(String(message.label)).toContain("npm test")
      },
      {
        id: "C9-9",
        title: "maps exec_command_end to progress end with status and metrics",
        event: { type: "exec_command_end", command: ["npm", "test"], status: "completed", exit_code: 0, duration: "1s" },
        tool: "exec_command",
        phase: "end",
        special: (message) => {
          expect(message.exitCode).toBe(0);
          expect(String(message.duration)).toContain("1");
        }
      },
      {
        id: "C9-10",
        title: "maps mcp_tool_call_begin to progress begin",
        event: { type: "mcp_tool_call_begin", tool_name: "search_docs", name: "search_docs" },
        tool: "mcp_tool",
        phase: "begin",
        special: (message) => expect(String(message.label).length).toBeGreaterThan(0)
      },
      {
        id: "C9-11",
        title: "maps mcp_tool_call_end to progress end",
        event: { type: "mcp_tool_call_end", tool_name: "search_docs", name: "search_docs", status: "success", duration: "10ms" },
        tool: "mcp_tool",
        phase: "end",
        special: (message) => expect(message.status).toBeDefined()
      },
      {
        id: "C9-12",
        title: "maps dynamic_tool_call_request to mcp_tool begin",
        event: { type: "dynamic_tool_call_request", tool_name: "custom_tool", name: "custom_tool" },
        tool: "mcp_tool",
        phase: "begin",
        special: (message) => expect(String(message.label).length).toBeGreaterThan(0)
      },
      {
        id: "C9-13",
        title: "maps dynamic_tool_call_response to mcp_tool end",
        event: { type: "dynamic_tool_call_response", success: false, tool_name: "custom_tool", name: "custom_tool" },
        tool: "mcp_tool",
        phase: "end",
        special: (message) => expect(message.status).toBeDefined()
      },
      {
        id: "C9-14",
        title: "maps web_search_begin to web_search begin",
        event: { type: "web_search_begin", query: "vitest docs" },
        tool: "web_search",
        phase: "begin"
      },
      {
        id: "C9-15",
        title: "maps web_search_end to web_search end",
        event: { type: "web_search_end", query: "vitest docs" },
        tool: "web_search",
        phase: "end",
        special: (message) => expect(String(message.label)).toContain("vitest docs")
      },
      {
        id: "C9-16",
        title: "maps image_generation_begin to image_gen begin",
        event: { type: "image_generation_begin", prompt: "a mountain" },
        tool: "image_gen",
        phase: "begin"
      },
      {
        id: "C9-17",
        title: "maps image_generation_end to image_gen end",
        event: { type: "image_generation_end", success: true },
        tool: "image_gen",
        phase: "end",
        special: (message) => expect(message.status).toBeDefined()
      },
      {
        id: "C9-20",
        title: "maps collab_agent_spawn_begin to collab_agent begin",
        event: { type: "collab_agent_spawn_begin", receiver_thread_id: "agent-1" },
        tool: "collab_agent",
        phase: "begin",
        special: (message) => expect(message.agentId).toBeDefined()
      },
      {
        id: "C9-21",
        title: "maps collab_agent_spawn_end to collab_agent end",
        event: { type: "collab_agent_spawn_end", receiver_thread_id: "agent-1" },
        tool: "collab_agent",
        phase: "end",
        special: (message) => expect(message.agentId).toBeDefined()
      },
      {
        id: "C9-23",
        title: "maps collab_agent_interaction_end to collab_agent end",
        event: { type: "collab_agent_interaction_end", receiver_thread_id: "agent-2" },
        tool: "collab_agent",
        phase: "end",
        special: (message) => expect(message.agentId).toBeDefined()
      },
      {
        id: "C9-24",
        title: "maps collab_waiting_begin to collab_agent begin",
        event: { type: "collab_waiting_begin" },
        tool: "collab_agent",
        phase: "begin"
      },
      {
        id: "C9-25",
        title: "maps collab_waiting_end to collab_agent end",
        event: { type: "collab_waiting_end" },
        tool: "collab_agent",
        phase: "end"
      },
      {
        id: "C9-26",
        title: "maps collab_close_begin to collab_agent begin",
        event: { type: "collab_close_begin" },
        tool: "collab_agent",
        phase: "begin"
      },
      {
        id: "C9-27",
        title: "maps collab_close_end to collab_agent end",
        event: { type: "collab_close_end" },
        tool: "collab_agent",
        phase: "end"
      },
      {
        id: "C9-28",
        title: "maps collab_resume_begin to collab_agent begin",
        event: { type: "collab_resume_begin" },
        tool: "collab_agent",
        phase: "begin"
      },
      {
        id: "C9-29",
        title: "maps collab_resume_end to collab_agent end",
        event: { type: "collab_resume_end" },
        tool: "collab_agent",
        phase: "end"
      }
    ];

  for (const testCase of progressCases) {
    it(`[${testCase.id}] ${testCase.title}`, () => {
      const output = transformEvent(testCase.event as never, ctx);
      expect(output).toMatchObject({
        kind: "progress",
        turnId: "turn-1",
        tool: testCase.tool,
        phase: testCase.phase
      });
      if (!output || output.kind !== "progress") {
        return;
      }
      testCase.special?.(output);
    });
  }

  it("[C9-30] maps exec_approval_request to command_exec approval", () => {
    const output = transformEvent(
      {
        type: "exec_approval_request",
        approval_id: "appr-1",
        command: ["npm", "test"]
      },
      ctx
    );

    expect(output).toMatchObject({
      kind: "approval",
      threadId: "thr-1",
      turnId: "turn-1",
      approvalType: "command_exec",
      approvalId: "appr-1",
      callId: ""
    });
  });

  it("[C9-31] maps apply_patch_approval_request to file_change approval", () => {
    const output = transformEvent(
      {
        type: "apply_patch_approval_request",
        call_id: "call-1",
        changes: {
          "src/a.ts": {}
        }
      },
      ctx
    );

    expect(output).toMatchObject({
      kind: "approval",
      threadId: "thr-1",
      turnId: "turn-1",
      approvalType: "file_change",
      callId: "call-1",
      changes: expect.anything()
    });
  });

  it("[C9-32] maps request_user_input questions into user_input message", () => {
    const output = transformEvent(
      {
        type: "request_user_input",
        questions: [
          {
            header: "Env",
            question: "选择环境",
            options: [{ label: "prod" }, { label: "staging" }]
          }
        ]
      },
      ctx
    );

    expect(output).toMatchObject({
      kind: "user_input",
      threadId: "thr-1",
      turnId: "turn-1",
      questions: expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("选择环境") })])
    });
  });

  it("[C9-34] maps task_started to turn_started notification", () => {
    expect(transformEvent({ type: "task_started" }, ctx)).toMatchObject({
      kind: "notification",
      category: "turn_started"
    });
  });

  it("[C9-35] maps task_complete to turn_complete notification with last agent message", () => {
    expect(transformEvent({ type: "task_complete", last_agent_message: "done" }, ctx)).toMatchObject({
      kind: "notification",
      category: "turn_complete",
      lastAgentMessage: "done"
    });
  });

  it("[C9-36] maps turn_aborted to turn_aborted notification", () => {
    expect(transformEvent({ type: "turn_aborted" }, ctx)).toMatchObject({
      kind: "notification",
      category: "turn_aborted"
    });
  });

  it("[C9-37] maps warning to warning notification with title from message", () => {
    expect(transformEvent({ type: "warning", message: "warning-message" }, ctx)).toMatchObject({
      kind: "notification",
      category: "warning",
      title: "warning-message"
    });
  });

  it("[C9-38] maps error to error notification with title from message", () => {
    expect(transformEvent({ type: "error", message: "error-message" }, ctx)).toMatchObject({
      kind: "notification",
      category: "error",
      title: "error-message"
    });
  });

  it("[C9-39] maps stream_error to error notification with title from message", () => {
    expect(transformEvent({ type: "stream_error", message: "stream failed" }, ctx)).toMatchObject({
      kind: "notification",
      category: "error",
      title: "stream failed"
    });
  });

  it("[C9-40] maps token_count to token_usage notification", () => {
    const output = transformEvent(
      {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 12,
            output_tokens: 34
          }
        }
      },
      ctx
    );
    expect(output).toMatchObject({
      kind: "notification",
      category: "token_usage",
      tokenUsage: { input: 12, output: 34 }
    });
  });

  it("[C9-46] maps agent_message to agent_message notification with lastAgentMessage", () => {
    const output = transformEvent(
      {
        type: "agent_message",
        message: "final response"
      },
      ctx
    );
    expect(output).toMatchObject({
      kind: "notification",
      category: "agent_message",
      lastAgentMessage: expect.any(String)
    });
  });

  const filteredTypes = [
    ["C9-48", "session_configured"],
    ["C9-49", "mcp_startup_update"],
    ["C9-50", "mcp_startup_complete"],
    ["C9-51", "background_event"],
    ["C9-52", "shutdown_complete"],
    ["C9-53", "raw_response_item"],
    ["C9-54", "unknown_event_xyz"]
  ] as const;

  for (const [id, type] of filteredTypes) {
    it(`[${id}] returns null for filtered or unknown event type ${type}`, () => {
      expect(transformEvent({ type }, ctx)).toBeNull();
    });
  }
});
