/**
 * @module src/server
 * @layer Wiring (composition root)
 *
 * Application entry point — constructs persistence + orchestrator layers via
 * factory functions, then delegates platform lifecycle to PlatformModules.
 *
 * ## Architecture
 * ```
 * server.ts
 *   ├── createPersistenceLayer(db) → PersistenceLayer
 *   ├── createOrchestratorLayer({ persistence, config }) → OrchestratorLayer
 *   ├── PlatformModule.bootstrap(ctx) → BootstrappedPlatformRuntime
 *   └── layer.runStartup(runtime.output) → wired + backfilled + recovered
 * ```
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import path from "node:path";

import {
  createLogger,
  setLogSink,
  createFileLogSink,
  multiSink,
  getLogSink,
  createFilteredSink,
  LOG_LEVEL_VALUES,
  setModuleLogLevels,
} from "../packages/logger/src/index";

import {
  createOrchestratorLayer,
} from "../services/orchestrator/src/index";
import { ConfigError, loadConfig } from "./config";
import { PlatformModuleRegistry } from "./platform/registry";
import { FeishuPlatformModule } from "./feishu/feishu-platform-module";
import { SlackPlatformModule } from "./slack/slack-platform-module";
import type { SlackSocketModeApp } from "./slack/slack-socket-mode-app";
import type { BootstrappedPlatformRuntime } from "./platform/types";

export interface RuntimeServices {
  platform: "feishu" | "slack";
  wsClient?: Lark.WSClient;
  slackApp?: SlackSocketModeApp;
  shutdown: () => Promise<void>;
}


export async function createServer(config = loadConfig()): Promise<RuntimeServices> {
  // 初始化日志持久化
  if (!process.env.VITEST) {
    const moduleLevels = String(process.env.LOG_MODULE_LEVELS ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .reduce<Record<string, "trace" | "debug" | "info" | "warn" | "error" | "fatal">>((acc, part) => {
        const [name, level] = part.split("=", 2).map((value) => value?.trim() ?? "");
        if (name && level && ["trace", "debug", "info", "warn", "error", "fatal"].includes(level)) {
          acc[name] = level as "trace" | "debug" | "info" | "warn" | "error" | "fatal";
        }
        return acc;
      }, {});
    if (Object.keys(moduleLevels).length > 0) {
      setModuleLogLevels(moduleLevels);
    }

    const consoleSink = getLogSink();
    const noisyDebugLoggers = new Set(
      String(process.env.LOG_DEBUG_MODULES ?? "stdio-rpc,acp-rpc")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );
    const isNoisyDebugEntry = (entry: { name: string; level: number }) =>
      noisyDebugLoggers.has(entry.name) && entry.level <= LOG_LEVEL_VALUES.debug;
    const isBackendRpcEntry = (entry: { name: string }) => entry.name === "backend-rpc";

    const logDir = process.env.LOG_DIR ?? path.join(config.dataDir, "logs");
    const mainFileSink = createFileLogSink({ dir: logDir });
    const stdioFileSink = createFileLogSink({
      dir: logDir,
      baseName: process.env.LOG_STDIO_BASE_NAME ?? "agent-stdio"
    });
    const backendRpcFileSink = createFileLogSink({
      dir: logDir,
      baseName: process.env.LOG_BACKEND_RPC_BASE_NAME ?? "backend-rpc"
    });

    setLogSink(multiSink(
      createFilteredSink(consoleSink, (entry) => !isNoisyDebugEntry(entry) && !isBackendRpcEntry(entry)),
      createFilteredSink(mainFileSink, (entry) => !isNoisyDebugEntry(entry)),
      createFilteredSink(stdioFileSink, isNoisyDebugEntry),
      createFilteredSink(backendRpcFileSink, isBackendRpcEntry)
    ));
  }
  const log = createLogger("server");

  const layer = await createOrchestratorLayer({ config });

  const platformRegistry = new PlatformModuleRegistry([
    new FeishuPlatformModule(),
    new SlackPlatformModule(),
  ]);
  const platformRuntime: BootstrappedPlatformRuntime = await platformRegistry.get(config.platform).bootstrap({
    config,
    db: layer.db,
    layer,
    persistence: layer.persistence,
  });

  // Wire OutputGateway + backfill + session recovery
  await layer.runStartup(platformRuntime.output);

  await platformRuntime.start();

  const shutdown = async (): Promise<void> => {
    await layer.shutdown();
    await platformRuntime.stop();
  };

  return { platform: config.platform, wsClient: platformRuntime.wsClient, slackApp: platformRuntime.slackApp, shutdown };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { shutdown, platform } = await createServer(config);

  const log = createLogger("server");
  log.info({ platform }, "Codex IM server started (Stream mode — WebSocket)");

  const graceful = async () => {
    await shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", graceful);
  process.on("SIGINT", graceful);
}

/* istanbul ignore next -- entry point guard */
if (!process.env.VITEST) {
  const bootLog = createLogger("boot");
  main().catch((error) => {
    if (error instanceof ConfigError) {
      bootLog.fatal({ err: error.message }, "config error");
      process.exit(1);
    }
    bootLog.fatal({
      err: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      cause: error instanceof Error && "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined
    }, "unhandled startup error");
    process.exit(1);
  });
}
