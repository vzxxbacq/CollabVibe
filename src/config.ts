import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_APP_LOCALE, parseAppLocale, type AppLocale } from "../packages/channel-core/src/app-locale";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface AppConfig {
  locale: AppLocale;
  feishu: {
    appId: string;
    appSecret: string;
    signingSecret?: string;
    encryptKey?: string;
    apiBaseUrl: string;
  };
  /** Workspace root directory (deployment-related, not a backend config) */
  cwd: string;
  /** Default sandbox policy for new projects */
  sandbox: string;
  /** Default approval policy for new projects */
  approvalPolicy: string;
  server: {
    port: number;
    approvalTimeoutMs: number;
    sysAdminUserIds: string[];
  };
}

function readRequired(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new ConfigError(`missing required environment variable: ${key}`);
  }
  return value;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

let envLoaded = false;

function ensureEnvLoaded(envFilePath?: string): void {
  if (envLoaded) {
    return;
  }

  const targetPath = envFilePath ?? path.resolve(process.cwd(), ".env");
  if (existsSync(targetPath)) {
    process.loadEnvFile(targetPath);
  }
  envLoaded = true;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, options?: { envFilePath?: string }): AppConfig {
  ensureEnvLoaded(options?.envFilePath);

  return {
    locale: (() => {
      try {
        return parseAppLocale(env.APP_LOCALE);
      } catch (error) {
        throw new ConfigError(error instanceof Error ? error.message : `invalid APP_LOCALE (default: ${DEFAULT_APP_LOCALE})`);
      }
    })(),
    feishu: {
      appId: readRequired(env, "FEISHU_APP_ID"),
      appSecret: readRequired(env, "FEISHU_APP_SECRET"),
      signingSecret: env.FEISHU_SIGNING_SECRET || undefined,
      encryptKey: env.FEISHU_ENCRYPT_KEY,
      apiBaseUrl: env.FEISHU_API_BASE_URL ?? "https://open.feishu.cn/open-apis"
    },
    cwd: env.CODEX_WORKSPACE_CWD ?? process.cwd(),
    sandbox: env.CODEX_SANDBOX ?? "workspace-write",
    approvalPolicy: env.CODEX_APPROVAL_POLICY ?? "on-request",
    server: {
      port: readNumber(env.PORT, 3000),
      approvalTimeoutMs: readNumber(env.APPROVAL_TIMEOUT_MS, 300_000),
      sysAdminUserIds: (env.SYS_ADMIN_USER_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    }
  };
}
