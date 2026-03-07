import type { UnifiedMessage } from "./types";

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((item) => typeof item === "string");
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

export function isUnifiedMessage(input: unknown): input is UnifiedMessage {
  if (!isObject(input)) {
    return false;
  }

  const base = input as Record<string, unknown>;
  if (
    typeof base.channel !== "string" ||
    typeof base.eventId !== "string" ||
    (base.traceId !== undefined && typeof base.traceId !== "string") ||
    typeof base.chatId !== "string" ||
    typeof base.userId !== "string" ||
    typeof base.timestamp !== "number" ||
    !("raw" in base)
  ) {
    return false;
  }

  if (base.type === "command") {
    return (
      typeof base.text === "string" &&
      typeof base.command === "string" &&
      isStringArray(base.args)
    );
  }

  if (base.type === "text") {
    return typeof base.text === "string" && isStringArray(base.mentions);
  }

  if (base.type === "card_action") {
    if (typeof base.action !== "string") {
      return false;
    }
    return isObject(base.value) && Object.values(base.value).every((value) => typeof value === "string");
  }

  return false;
}

export function assertUnifiedMessage(input: unknown): UnifiedMessage {
  if (!isUnifiedMessage(input)) {
    throw new Error("Invalid unified message");
  }
  return input;
}
