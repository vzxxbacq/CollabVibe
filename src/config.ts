import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_APP_LOCALE, parseAppLocale, type AppLocale } from "./common/app-locale";
import type { AppConfig } from "../services/index";

export type { AppConfig } from "../services/index";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function readRequired(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new ConfigError(`missing required environment variable: ${key}`);
  }
  return value;
}

function readOptionalPlatformConfig(env: NodeJS.ProcessEnv): Pick<AppConfig, "platform" | "feishu" | "slack"> {
  const requestedPlatform = env.IM_PLATFORM?.trim();
  const feishuTouched = [env.FEISHU_APP_ID, env.FEISHU_APP_SECRET, env.FEISHU_SIGNING_SECRET, env.FEISHU_ENCRYPT_KEY]
    .some((value) => value !== undefined);
  const slackTouched = [env.SLACK_BOT_TOKEN, env.SLACK_APP_TOKEN]
    .some((value) => value !== undefined);
  const hasFeishu = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET);
  const hasSlack = Boolean(env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN);

  const platform = (() => {
    if (requestedPlatform === "feishu" || requestedPlatform === "slack") {
      return requestedPlatform;
    }
    if (hasFeishu && !hasSlack) {
      return "feishu";
    }
    if (hasSlack && !hasFeishu) {
      return "slack";
    }
    if (feishuTouched && !slackTouched) {
      return "feishu";
    }
    if (slackTouched && !feishuTouched) {
      return "slack";
    }
    if (!hasFeishu && !hasSlack) {
      throw new ConfigError("missing platform credentials: configure Feishu or Slack tokens");
    }
    throw new ConfigError("ambiguous platform config: set IM_PLATFORM=feishu or IM_PLATFORM=slack");
  })();

  return {
    platform,
    feishu: platform === "feishu" ? {
      appId: readRequired(env, "FEISHU_APP_ID"),
      appSecret: readRequired(env, "FEISHU_APP_SECRET"),
      signingSecret: env.FEISHU_SIGNING_SECRET || undefined,
      encryptKey: env.FEISHU_ENCRYPT_KEY,
      apiBaseUrl: env.FEISHU_API_BASE_URL ?? "https://open.feishu.cn/open-apis",
      httpTimeoutMs: 15_000,
      cardDeliveryMode: "static",
      cardUpdateIntervalMs: 30_000,
    } : {
      appId: "",
      appSecret: "",
      signingSecret: undefined,
      encryptKey: undefined,
      apiBaseUrl: env.FEISHU_API_BASE_URL ?? "https://open.feishu.cn/open-apis",
      httpTimeoutMs: 15_000,
      cardDeliveryMode: "static",
      cardUpdateIntervalMs: 30_000,
    },
    slack: platform === "slack" ? {
      botToken: readRequired(env, "SLACK_BOT_TOKEN"),
      appToken: readRequired(env, "SLACK_APP_TOKEN")
    } : {
      botToken: "",
      appToken: ""
    }
  };
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

function readFeishuCardDeliveryMode(value: string | undefined): "static" | "stream" {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized.length === 0) {
    return "static";
  }
  if (normalized === "static" || normalized === "stream") {
    return normalized;
  }
  throw new ConfigError("invalid FEISHU_CARD_DELIVERY_MODE (expected: static | stream)");
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

  const platformConfig = readOptionalPlatformConfig(env);

  return {
    platform: platformConfig.platform,
    locale: (() => {
      try {
        return parseAppLocale(env.APP_LOCALE);
      } catch (error) {
        throw new ConfigError(error instanceof Error ? error.message : `invalid APP_LOCALE (default: ${DEFAULT_APP_LOCALE})`);
      }
    })(),
    slack: platformConfig.slack,
    cwd: path.resolve(readRequired(env, "COLLABVIBE_WORKSPACE_CWD"), "workspace"),
    dataDir: path.resolve(readRequired(env, "COLLABVIBE_WORKSPACE_CWD")),
    sandbox: env.CODEX_SANDBOX ?? "workspace-write",
    approvalPolicy: env.CODEX_APPROVAL_POLICY ?? "on-request",
    server: {
      port: readNumber(env.PORT, 3000),
      approvalTimeoutMs: readNumber(env.APPROVAL_TIMEOUT_MS, 300_000),
      sysAdminUserIds: (env.SYS_ADMIN_USER_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    },
    feishu: {
      ...platformConfig.feishu,
      httpTimeoutMs: readNumber(env.FEISHU_HTTP_TIMEOUT_MS, 15_000),
      cardDeliveryMode: readFeishuCardDeliveryMode(env.FEISHU_CARD_DELIVERY_MODE),
      cardUpdateIntervalMs: readNumber(env.FEISHU_CARD_UPDATE_INTERVAL_MS, 30_000),
    }
  };
}
