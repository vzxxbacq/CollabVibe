export * from "./project-types";
export * from "./orchestrator-config";
export { type AdminPersistedState, type AdminStateStore } from "./admin-state";
export * from "../iam/user-repository";

// AppConfig — application-level configuration (extends OrchestratorConfig)
import type { OrchestratorConfig } from "./orchestrator-config";
import type { AppLocale } from "../types/app-locale";

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
