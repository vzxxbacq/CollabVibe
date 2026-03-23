const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function looksOpaqueApprovalValue(value: string | undefined, disallow: string[] = []): boolean {
  if (!value) return false;
  const normalized = value.trim();
  if (normalized.length === 0) return false;
  if (UUID_LIKE_RE.test(normalized)) return true;
  return disallow.some((item) => item && normalized === item);
}

export function safeApprovalText(value: string | undefined, disallow: string[] = []): string | undefined {
  return looksOpaqueApprovalValue(value, disallow) ? undefined : nonEmptyString(value);
}

export function summarizeText(value: string | undefined, limit = 160): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function summarizeCommand(command: string[] | undefined, limit = 160): string | undefined {
  return command && command.length > 0 ? summarizeText(command.join(" "), limit) : undefined;
}

export interface ApprovalDisplaySource {
  approvalType: "command_exec" | "file_change";
  requestId?: string;
  callId?: string;
  description?: string;
  reason?: string;
  cwd?: string;
  files?: string[];
  command?: string[];
  displayNameCandidates?: Array<string | undefined>;
  summaryCandidates?: Array<string | undefined>;
  fallbackDisplayName?: string;
  fallbackDescription?: string;
}

export interface ApprovalDisplayResult {
  displayName?: string;
  summary?: string;
  reason?: string;
  cwd?: string;
  files?: string[];
  command?: string[];
  description: string;
}

export function buildApprovalDisplay(source: ApprovalDisplaySource): ApprovalDisplayResult {
  const disallow = [source.requestId ?? "", source.callId ?? ""];
  const displayName = (source.displayNameCandidates ?? [])
    .map((item) => safeApprovalText(item, disallow))
    .find(Boolean)
    ?? safeApprovalText(source.fallbackDisplayName, disallow);
  const summary = (source.summaryCandidates ?? [])
    .map((item) => safeApprovalText(item, disallow))
    .find(Boolean);
  const reason = nonEmptyString(source.reason);
  const cwd = nonEmptyString(source.cwd);
  const files = source.files?.map((item) => safeApprovalText(item, disallow)).filter(Boolean) as string[] | undefined;
  const command = source.command?.map((item) => nonEmptyString(item)).filter(Boolean) as string[] | undefined;
  const description = source.approvalType === "command_exec"
    ? `Command approval: ${summary ?? reason ?? source.fallbackDescription ?? "command execution"}`
    : reason ?? source.fallbackDescription ?? "File change approval";
  return {
    displayName,
    summary,
    reason,
    cwd,
    files: files && files.length > 0 ? files : undefined,
    command: command && command.length > 0 ? command : undefined,
    description
  };
}
