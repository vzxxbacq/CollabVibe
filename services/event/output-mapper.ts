import type { IMOutputMessage } from "../event/im-output";
import type { PlatformOutput } from "./output-contracts";

export function toPlatformOutput(message: IMOutputMessage): PlatformOutput {
  switch (message.kind) {
    case "content":
      return { kind: "content", data: message };
    case "reasoning":
      return { kind: "reasoning", data: message };
    case "plan":
      return { kind: "plan", data: message };
    case "plan_update":
      return { kind: "plan_update", data: message };
    case "tool_output":
      return { kind: "tool_output", data: message };
    case "progress":
      return { kind: "progress", data: message };
    case "approval":
      return { kind: "approval_request", data: message };
    case "user_input":
      return { kind: "user_input_request", data: message };
    case "notification":
      return { kind: "notification", data: message };
    case "turn_summary":
      return { kind: "turn_summary", data: message };
    case "merge_event":
      return { kind: "merge_event", data: message.data };
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}
