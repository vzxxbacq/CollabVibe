import type { ParsedIntent, UnifiedMessage } from "./intent-types";

export function routeIntent(message: UnifiedMessage): ParsedIntent {
  if (message.type === "card_action") {
    return { intent: "UNKNOWN", args: {} };
  }

  // Local slash command parsing has been removed for inbound text/command messages.
  // They are treated as regular turn inputs unless a platform-specific handler
  // classifies them earlier in the flow.
  return { intent: "TURN_START", args: {} };
}

export const PLATFORM_ONLY_INTENTS = new Set<string>([
  "PROJECT_CREATE",
  "PROJECT_LIST",
  "MODEL_SET",
  "MODEL_LIST",
  "SKILL_INSTALL",
  "SKILL_LIST",
  "SKILL_REMOVE",
  "SKILL_ADMIN",
  "SNAPSHOT_LIST",
  "HELP",
  "ADMIN_HELP"
]);

export function shouldRouteToAgent(intent: string, messageType: "command" | "text" | "card_action" | "file_upload"): boolean {
  if (messageType === "card_action") {
    return false;
  }
  if (intent === "UNKNOWN") {
    return false;
  }
  if (PLATFORM_ONLY_INTENTS.has(intent)) {
    return false;
  }
  return true;
}
