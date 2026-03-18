export * from "./admin-state";
export * from "./user-repository";

// AppConfig — application-level configuration (extends OrchestratorConfig)
import type { OrchestratorConfig } from "./admin-state";
import type { AppLocale } from "../im/app-locale";
export type { AppLocale } from "../im/app-locale";

export interface AppConfig extends OrchestratorConfig {
  locale: AppLocale;
  platform: "feishu" | "slack";
  feishu: {
    appId: string;
    appSecret: string;
    signingSecret?: string;
    encryptKey?: string;
    apiBaseUrl: string;
  };
  slack: {
    botToken: string;
    appToken: string;
  };
}
