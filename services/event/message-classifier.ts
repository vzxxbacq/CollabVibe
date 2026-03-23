import type { IMOutputMessage } from "./im-output";

export function isStreamingMessage(message: IMOutputMessage): boolean {
  return (
    message.kind === "content" ||
    message.kind === "reasoning" ||
    message.kind === "plan" ||
    message.kind === "tool_output"
  );
}

export function isCriticalMessage(message: IMOutputMessage): boolean {
  if (message.kind === "approval" || message.kind === "user_input") {
    return true;
  }
  if (message.kind === "plan_update" || message.kind === "progress" || message.kind === "turn_summary") {
    return true;
  }
  if (message.kind !== "notification") {
    return false;
  }
  return (
    message.category === "turn_started" ||
    message.category === "turn_complete" ||
    message.category === "turn_aborted" ||
    message.category === "error" ||
    message.category === "warning" ||
    message.category === "model_reroute" ||
    message.category === "token_usage"
  );
}
