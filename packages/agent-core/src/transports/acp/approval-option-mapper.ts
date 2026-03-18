import type { AcpApprovalMapping } from "./types";

const OPTION_TO_ACTION: Record<string, "approve" | "deny" | "approve_always"> = {
  allow_once: "approve",
  allow_always: "approve_always",
  deny: "deny"
};

const ACTION_TO_OPTION: Record<"approve" | "deny" | "approve_always", string> = {
  approve: "allow_once",
  approve_always: "allow_always",
  deny: "deny"
};

export function createApprovalOptionMapper(): AcpApprovalMapping {
  return {
    toImAction(optionId) {
      return OPTION_TO_ACTION[optionId] ?? null;
    },
    toOptionId(action) {
      return ACTION_TO_OPTION[action] ?? null;
    }
  };
}
