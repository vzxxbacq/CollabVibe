import type * as Lark from "@larksuiteoapi/node-sdk";
import type { DatabaseSync } from "node:sqlite";
import type { SlackSocketModeApp } from "../slack/slack-socket-mode-app";
import type { AppConfig } from "../config";
import type { OrchestratorLayer } from "../../services/orchestrator/src/index";
import type { PersistenceLayer } from "../../services/persistence/src/index";
import type { OutputGateway } from "../../services/contracts/im/platform-output";

export interface PlatformModuleContext {
  config: AppConfig;
  db: DatabaseSync;
  layer: OrchestratorLayer;
  persistence: PersistenceLayer;
}

export interface BootstrappedPlatformRuntime {
  platform: "feishu" | "slack";
  output: OutputGateway;
  wsClient?: Lark.WSClient;
  slackApp?: SlackSocketModeApp;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface PlatformModule {
  platformId: "feishu" | "slack";
  bootstrap(ctx: PlatformModuleContext): Promise<BootstrappedPlatformRuntime>;
}
