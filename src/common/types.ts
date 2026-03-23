import type * as Lark from "@larksuiteoapi/node-sdk";
import type { SlackSocketModeApp } from "../slack/slack-socket-mode-app";
import type { AppConfig } from "../config";
import type { OrchestratorApi, OrchestratorLayer, TurnCardData } from "../../services/index";
import type { OutputGateway } from "./platform-output";

// ── CoreDeps (from former src/handlers/types.ts) ─────────────────────────────

/**
 * CoreDeps — L1 handler 的平台无关依赖注入容器。
 *
 * `api: OrchestratorApi` 是访问所有 orchestrator 功能的唯一入口。
 */
export interface CoreDeps {
  config: AppConfig;
  /** The sole gateway to orchestrator functionality (§0–§9) */
  api: OrchestratorApi;
}

export type CardActionResponse = { card: { type: "raw"; data: Record<string, unknown> } } | void;

export interface TurnCardReader {
  resolveProjectId(chatId: string): string | null;
  getTurnCardData(input: { projectId: string; turnId: string }): Promise<TurnCardData | null>;
}

export interface PlatformModuleContext {
  config: AppConfig;
  layer: OrchestratorLayer;
  api: OrchestratorApi;
  turnCardReader: TurnCardReader;
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
