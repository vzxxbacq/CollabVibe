export interface PendingFeishuSkillUpload {
  chatId: string;
  userId: string;
  pluginName?: string;
  autoEnableProjectId?: string;
  expiresAt: number;
}

export interface StagedFeishuSkillInstall extends PendingFeishuSkillUpload {
  pluginName: string;
  localPath: string;
  tempDir: string;
  originalName?: string;
  manifestName?: string;
  manifestDescription?: string;
}

const pendingUploads = new Map<string, PendingFeishuSkillUpload>();
const stagedInstalls = new Map<string, StagedFeishuSkillInstall>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function key(chatId: string, userId: string): string {
  return `${chatId}:${userId}`;
}

export function armPendingFeishuSkillInstall(input: {
  chatId: string;
  userId: string;
  pluginName?: string;
  autoEnableProjectId?: string;
  ttlMs?: number;
  onExpire?: () => void;
}): PendingFeishuSkillUpload {
  const state: PendingFeishuSkillUpload = {
    chatId: input.chatId,
    userId: input.userId,
    pluginName: input.pluginName,
    autoEnableProjectId: input.autoEnableProjectId,
    expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS),
  };
  pendingUploads.set(key(input.chatId, input.userId), state);
  stagedInstalls.delete(key(input.chatId, input.userId));
  scheduleExpiry(key(input.chatId, input.userId), input.ttlMs, () => {
    pendingUploads.delete(key(input.chatId, input.userId));
    stagedInstalls.delete(key(input.chatId, input.userId));
    input.onExpire?.();
  });
  return state;
}

export function consumePendingFeishuSkillInstall(chatId: string, userId: string): PendingFeishuSkillUpload | null {
  const k = key(chatId, userId);
  const current = pendingUploads.get(k);
  if (!current) return null;
  pendingUploads.delete(k);
  clearScheduledExpiry(k);
  if (current.expiresAt < Date.now()) return null;
  return current;
}

export function peekPendingFeishuSkillInstall(chatId: string, userId: string): PendingFeishuSkillUpload | null {
  const current = pendingUploads.get(key(chatId, userId));
  if (!current) return null;
  if (current.expiresAt < Date.now()) {
    pendingUploads.delete(key(chatId, userId));
    return null;
  }
  return current;
}

export function stageFeishuSkillInstall(input: {
  chatId: string;
  userId: string;
  pluginName: string;
  autoEnableProjectId?: string;
  localPath: string;
  tempDir: string;
  originalName?: string;
  manifestName?: string;
  manifestDescription?: string;
  ttlMs?: number;
  onExpire?: (staged: StagedFeishuSkillInstall) => void;
}): StagedFeishuSkillInstall {
  const state: StagedFeishuSkillInstall = {
    chatId: input.chatId,
    userId: input.userId,
    pluginName: input.pluginName,
    autoEnableProjectId: input.autoEnableProjectId,
    localPath: input.localPath,
    tempDir: input.tempDir,
    originalName: input.originalName,
    manifestName: input.manifestName,
    manifestDescription: input.manifestDescription,
    expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS),
  };
  stagedInstalls.set(key(input.chatId, input.userId), state);
  scheduleExpiry(key(input.chatId, input.userId), input.ttlMs, () => {
    const current = stagedInstalls.get(key(input.chatId, input.userId));
    pendingUploads.delete(key(input.chatId, input.userId));
    stagedInstalls.delete(key(input.chatId, input.userId));
    if (current) input.onExpire?.(current);
  });
  return state;
}

export function peekStagedFeishuSkillInstall(chatId: string, userId: string): StagedFeishuSkillInstall | null {
  const current = stagedInstalls.get(key(chatId, userId));
  if (!current) return null;
  if (current.expiresAt < Date.now()) {
    stagedInstalls.delete(key(chatId, userId));
    return null;
  }
  return current;
}

export function consumeStagedFeishuSkillInstall(chatId: string, userId: string): StagedFeishuSkillInstall | null {
  const k = key(chatId, userId);
  const current = stagedInstalls.get(k);
  if (!current) return null;
  stagedInstalls.delete(k);
  clearScheduledExpiry(k);
  if (current.expiresAt < Date.now()) return null;
  return current;
}

export function clearFeishuSkillInstallState(chatId: string, userId: string): StagedFeishuSkillInstall | null {
  const k = key(chatId, userId);
  pendingUploads.delete(k);
  const staged = stagedInstalls.get(k) ?? null;
  stagedInstalls.delete(k);
  clearScheduledExpiry(k);
  return staged;
}

function scheduleExpiry(stateKey: string, ttlMs = DEFAULT_TTL_MS, onExpire?: () => void): void {
  clearScheduledExpiry(stateKey);
  timers.set(stateKey, setTimeout(() => {
    timers.delete(stateKey);
    onExpire?.();
  }, ttlMs));
}

function clearScheduledExpiry(stateKey: string): void {
  const timer = timers.get(stateKey);
  if (timer) clearTimeout(timer);
  timers.delete(stateKey);
}
