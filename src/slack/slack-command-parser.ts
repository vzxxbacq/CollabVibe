import type { ParsedIntent } from "../common/intent-types";

export interface SlackReplyCommand {
  kind: "reply";
  callId: string;
  answer: string;
}

export interface SlackMergeCommand {
  kind: "merge";
  action:
    | "preview"
    | "confirm"
    | "force"
    | "review"
    | "accept_all"
    | "commit"
    | "cancel"
    | "agent"
    | "retry"
    | "decide";
  branchName: string;
  decision?: "accept" | "keep_main" | "use_branch" | "skip";
  filePath?: string;
  prompt?: string;
}

export type SlackParsedCommand =
  | { kind: "intent"; intent: ParsedIntent }
  | SlackReplyCommand
  | SlackMergeCommand;

function parseMentionTarget(raw: string): string {
  const match = raw.match(/^<@([A-Z0-9]+)(?:\|[^>]+)?>$/i);
  return match ? match[1] : raw;
}

export function parseSlackCommand(text: string): SlackParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  const root = parts[0];

  if (root === "/help") {
    return { kind: "intent", intent: { intent: "HELP", args: {} } };
  }

  if (root === "/models" || root === "/model") {
    if (parts[1] === "list" || parts.length === 1) {
      return { kind: "intent", intent: { intent: "MODEL_LIST", args: {} } };
    }
  }

  if (root === "/backends" || root === "/backend") {
    return { kind: "intent", intent: { intent: "HELP", args: { topic: "backends" } } };
  }

  if (root === "/project") {
    if (parts[1] === "list") {
      return { kind: "intent", intent: { intent: "PROJECT_LIST", args: {} } };
    }
    if (parts[1] === "create") {
      const name = parts[2] ?? "";
      const cwd = parts[3] ?? "";
      return { kind: "intent", intent: { intent: "PROJECT_CREATE", args: { name, cwd } } };
    }
  }

  if (root === "/thread") {
    const sub = parts[1] ?? "";
    if (sub === "new") {
      return {
        kind: "intent",
        intent: {
          intent: "THREAD_NEW",
          args: {
            name: parts[2] ?? "",
            backendModel: parts[3] ?? ""
          }
        }
      };
    }
    if (sub === "list") {
      return { kind: "intent", intent: { intent: "THREAD_LIST", args: {} } };
    }
    if (sub === "join" || sub === "resume") {
      return { kind: "intent", intent: { intent: "THREAD_SWITCH", args: { action: sub, name: parts[2] ?? "" } } };
    }
    if (sub === "leave" || sub === "main") {
      return { kind: "intent", intent: { intent: "THREAD_SWITCH", args: { action: "leave" } } };
    }
  }

  if (root === "/snapshot" || root === "/history") {
    if (parts[1] === "jump") {
      return { kind: "intent", intent: { intent: "SNAPSHOT_LIST", args: { action: "jump", turnId: parts[2] ?? "" } } };
    }
    return { kind: "intent", intent: { intent: "SNAPSHOT_LIST", args: {} } };
  }

  if (root === "/turn") {
    const sub = parts[1] ?? "";
    if (sub === "list") {
      return { kind: "intent", intent: { intent: "HELP", args: { topic: "turns" } } };
    }
    if (sub === "view") {
      return { kind: "intent", intent: { intent: "HELP", args: { topic: "turn_view", turnId: parts[2] ?? "" } } };
    }
  }

  if (root === "/skill") {
    const sub = parts[1] ?? "";
    if (sub === "list") {
      return { kind: "intent", intent: { intent: "SKILL_LIST", args: {} } };
    }
    if (sub === "install") {
      return { kind: "intent", intent: { intent: "SKILL_INSTALL", args: { source: parts.slice(2).join(" ") } } };
    }
    if (sub === "remove") {
      return { kind: "intent", intent: { intent: "SKILL_REMOVE", args: { name: parts[2] ?? "" } } };
    }
    if (sub === "admin") {
      return { kind: "intent", intent: { intent: "SKILL_ADMIN", args: {} } };
    }
  }

  if (root === "/user") {
    const sub = parts[1] ?? "";
    if (sub === "list") return { kind: "intent", intent: { intent: "USER_LIST", args: {} } };
    if (sub === "add") return {
      kind: "intent",
      intent: { intent: "USER_ADD", args: { target: parseMentionTarget(parts[2] ?? ""), role: parts[3] ?? "developer" } }
    };
    if (sub === "role") return {
      kind: "intent",
      intent: { intent: "USER_ROLE", args: { target: parseMentionTarget(parts[2] ?? ""), role: parts[3] ?? "" } }
    };
    if (sub === "remove") return {
      kind: "intent",
      intent: { intent: "USER_REMOVE", args: { target: parseMentionTarget(parts[2] ?? "") } }
    };
  }

  if (root === "/admin") {
    const sub = parts[1] ?? "";
    if (sub === "list") return { kind: "intent", intent: { intent: "ADMIN_LIST", args: {} } };
    if (sub === "add") return {
      kind: "intent",
      intent: { intent: "ADMIN_ADD", args: { target: parseMentionTarget(parts[2] ?? "") } }
    };
    if (sub === "remove") return {
      kind: "intent",
      intent: { intent: "ADMIN_REMOVE", args: { target: parseMentionTarget(parts[2] ?? "") } }
    };
  }

  if (root === "/reply") {
    return {
      kind: "reply",
      callId: parts[1] ?? "",
      answer: parts.slice(2).join(" ").trim()
    };
  }

  if (root === "/merge") {
    const sub = parts[1] ?? "";
    const branchName = parts[2] ?? "";
    if (sub && !["preview", "confirm", "force", "review", "accept-all", "commit", "cancel", "agent", "retry", "decide"].includes(sub)) {
      return { kind: "merge", action: "preview", branchName: sub };
    }
    if (sub === "preview") return { kind: "merge", action: "preview", branchName };
    if (sub === "confirm") return { kind: "merge", action: "confirm", branchName };
    if (sub === "force") return { kind: "merge", action: "force", branchName };
    if (sub === "review") return { kind: "merge", action: "review", branchName };
    if (sub === "accept-all") return { kind: "merge", action: "accept_all", branchName };
    if (sub === "commit") return { kind: "merge", action: "commit", branchName };
    if (sub === "cancel") return { kind: "merge", action: "cancel", branchName };
    if (sub === "agent") return {
      kind: "merge",
      action: "agent",
      branchName,
      prompt: parts.slice(3).join(" ").trim()
    };
    if (sub === "retry") return {
      kind: "merge",
      action: "retry",
      branchName,
      filePath: parts[3] ?? "",
      prompt: parts.slice(4).join(" ").trim()
    };
    if (sub === "decide") {
      const rawDecision = parts[3] ?? "";
      const decision = rawDecision === "accept" || rawDecision === "keep_main" || rawDecision === "use_branch" || rawDecision === "skip"
        ? rawDecision
        : undefined;
      return {
        kind: "merge",
        action: "decide",
        branchName,
        decision,
        filePath: parts.slice(4).join(" ").trim()
      };
    }
  }

  return null;
}
