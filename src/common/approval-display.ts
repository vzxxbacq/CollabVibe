import type { IMApprovalRequest } from "../../services/index";

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function isOpaqueApprovalText(value: string | undefined, ids: string[] = []): boolean {
  if (!value) return false;
  const text = value.trim();
  if (!text) return false;
  if (UUID_LIKE_RE.test(text)) return true;
  return ids.some((id) => id && id === text);
}

export function readApprovalField(value: unknown, ids: string[] = []): string | undefined {
  const text = nonEmpty(value);
  return text && !isOpaqueApprovalText(text, ids) ? text : undefined;
}

export function getApprovalIds(req: Pick<IMApprovalRequest, "approvalId" | "callId">): string[] {
  return [req.approvalId, req.callId];
}

export function getApprovalDisplayName(req: IMApprovalRequest): string | undefined {
  return readApprovalField(req.displayName, getApprovalIds(req));
}

export function getApprovalReason(req: IMApprovalRequest): string | undefined {
  return readApprovalField(req.reason, getApprovalIds(req));
}

export function getApprovalCwd(req: IMApprovalRequest): string | undefined {
  return readApprovalField(req.cwd, getApprovalIds(req));
}

export function getApprovalFiles(req: IMApprovalRequest): string[] {
  const ids = getApprovalIds(req);
  const candidates = Array.isArray(req.files) ? req.files : Object.keys(req.changes ?? {});
  return candidates.map((item) => readApprovalField(String(item ?? ""), ids)).filter(Boolean) as string[];
}

export function getApprovalSummary(req: IMApprovalRequest, fileCountLabel?: (count: number) => string): string {
  const ids = getApprovalIds(req);
  const explicitSummary = readApprovalField(req.summary, ids);
  if (explicitSummary) return explicitSummary;
  if (req.approvalType === "command_exec") {
    const commandSummary = readApprovalField(req.command?.join(" "), ids);
    if (commandSummary) return commandSummary;
    const reason = getApprovalReason(req);
    if (reason) return reason;
    return req.description;
  }
  const files = getApprovalFiles(req);
  if (files.length > 0 && fileCountLabel) return fileCountLabel(files.length);
  return req.description;
}

export function buildApprovalResultSummaryFromActionValue(actionValue: Record<string, unknown>): string | undefined {
  const ids = [String(actionValue.approvalId ?? ""), String(actionValue.callId ?? "")];
  const displayName = readApprovalField(actionValue.displayName, ids);
  const summary = readApprovalField(actionValue.summary, ids)
    ?? readApprovalField(actionValue.commandSummary, ids)
    ?? readApprovalField(actionValue.description, ids);
  const reason = readApprovalField(actionValue.reason, ids);
  const cwd = readApprovalField(actionValue.cwd, ids);
  const parts = [displayName, summary && summary !== displayName ? summary : undefined, reason && reason !== summary ? reason : undefined];
  if (cwd) parts.push(`cwd: ${cwd}`);
  return parts.filter(Boolean).join("\n") || undefined;
}

export function readApprovalActionValue(actionValue: Record<string, unknown>, field: string): string | undefined {
  const ids = [String(actionValue.approvalId ?? ""), String(actionValue.callId ?? "")];
  return readApprovalField(actionValue[field], ids);
}

export function readApprovalActionFiles(actionValue: Record<string, unknown>): string[] {
  const ids = [String(actionValue.approvalId ?? ""), String(actionValue.callId ?? "")];
  if (!Array.isArray(actionValue.files)) return [];
  return actionValue.files
    .map((item) => readApprovalField(item, ids))
    .filter(Boolean) as string[];
}
