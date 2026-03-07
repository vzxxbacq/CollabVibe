import type { ParsedIntent, UnifiedMessage } from "./types";

function parseArgs(tokens: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = tokens[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function tokenizeCommandText(text: string): string[] {
  const rawTokens = text.trim().split(/\s+/g);
  const tokens: string[] = [];
  let quotedParts: string[] | null = null;

  for (const token of rawTokens) {
    if (!quotedParts) {
      if (token.startsWith("\"") && !token.endsWith("\"")) {
        quotedParts = [token.slice(1)];
        continue;
      }
      tokens.push(token);
      continue;
    }

    if (token.endsWith("\"")) {
      quotedParts.push(token.slice(0, -1));
      tokens.push(quotedParts.join(" "));
      quotedParts = null;
      continue;
    }

    quotedParts.push(token);
  }

  if (quotedParts) {
    tokens.push(`"${quotedParts.join(" ")}`);
  }

  return tokens;
}

function parseCommand(text: string): ParsedIntent {
  const tokens = tokenizeCommandText(text);
  const [command = "", ...rest] = tokens;
  const args = parseArgs(rest);

  switch (command) {
    case "/project":
      if (rest[0] === "create") {
        return { intent: "PROJECT_CREATE", command, args };
      }
      if (rest[0] === "list") {
        return { intent: "PROJECT_LIST", command, args };
      }
      break;
    case "/thread":
      if (rest[0] === "new") {
        return { intent: "THREAD_NEW", command, args };
      }
      if (rest[0] === "resume") {
        return { intent: "THREAD_RESUME", command, args };
      }
      break;
    case "/skill":
      if (rest[0] === "install") {
        return { intent: "SKILL_INSTALL", command, args };
      }
      if (rest[0] === "list") {
        return { intent: "SKILL_LIST", command, args };
      }
      break;
    case "/interrupt":
      return { intent: "TURN_INTERRUPT", command, args };
    default:
      break;
  }

  return { intent: "UNKNOWN", command, args };
}

export function routeIntent(message: UnifiedMessage): ParsedIntent {
  if (message.type === "command") {
    return parseCommand(message.text);
  }

  if (message.type === "text") {
    return { intent: "TURN_START", args: {} };
  }

  return { intent: "UNKNOWN", args: {} };
}
