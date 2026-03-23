import * as Lark from "@larksuiteoapi/node-sdk";
import { FeishuWsApp } from "./feishu-ws-app";
import { handleFeishuCardAction } from "./feishu-card-handler";
import { handleFeishuMessage } from "./feishu-message-handler";
import { FeishuOutputGateway } from "./platform-output-dispatcher";
import type { FeishuHandlerDeps } from "./types";
import { ConfigError } from "../config";
import type { BootstrappedPlatformRuntime, PlatformModule, PlatformModuleContext } from "../common/types";
import { resolveProjectByChatId } from "../common/project-resolution";
import { createLogger } from "../logging";
import { FeishuAdapter, FeishuOutputAdapter, FetchHttpClient } from "./channel/index";

const log = createLogger("feishu-platform-module");

function extractChatId(data: Record<string, unknown>): string {
  const direct = typeof data.chat_id === "string" ? data.chat_id : "";
  const nestedChat = data.chat as Record<string, unknown> | undefined;
  const nested = typeof nestedChat?.chat_id === "string" ? nestedChat.chat_id : "";
  return direct || nested;
}

function extractOpenId(data: Record<string, unknown>, field: string): string {
  const nested = data[field] as Record<string, unknown> | undefined;
  const operatorId = nested?.operator_id as Record<string, unknown> | undefined;
  const userId = nested?.user_id as Record<string, unknown> | undefined;
  if (typeof operatorId?.open_id === "string") return operatorId.open_id;
  if (typeof userId?.open_id === "string") return userId.open_id;
  if (typeof nested?.open_id === "string") return nested.open_id;
  return "";
}

export class FeishuPlatformModule implements PlatformModule {
  readonly platformId = "feishu" as const;

  async bootstrap(ctx: PlatformModuleContext): Promise<BootstrappedPlatformRuntime> {
    if (!ctx.config.feishu) {
      throw new ConfigError("feishu platform bootstrap is incomplete");
    }

    // Construct all Feishu infrastructure internally — private implementation details
    const httpClient = new FetchHttpClient(ctx.config.feishu);
    const feishuAdapter = new FeishuAdapter({
      appId: ctx.config.feishu.appId,
      appSecret: ctx.config.feishu.appSecret,
      signingSecret: ctx.config.feishu.signingSecret ?? "",
      apiBaseUrl: ctx.config.feishu.apiBaseUrl,
      httpClient,
    });
    const feishuPlatformOutput = new FeishuOutputAdapter(feishuAdapter, {
      turnCardReader: ctx.turnCardReader,
      locale: ctx.config.locale,
    });

    const deps: FeishuHandlerDeps = {
      config: ctx.config,
      feishuAdapter,
      platformOutput: feishuPlatformOutput,
      api: ctx.api,
      recentMessageIds: new Set<string>(),
      messageDedupTtlMs: 60_000,
    };

    const runtime: BootstrappedPlatformRuntime = {
      platform: "feishu",
      output: new FeishuOutputGateway(deps),
      wsClient: undefined,
      start: async () => {
        const wsApp = new FeishuWsApp({
          appId: ctx.config.feishu!.appId,
          appSecret: ctx.config.feishu!.appSecret,
          loggerLevel: Lark.LoggerLevel.info,
          onInboundMessage: (data) => handleFeishuMessage(deps, data),
          onCardAction: (data) => handleFeishuCardAction(deps, data),
          onBotAdded: async (data) => {
            try {
              const payload = data as Record<string, unknown>;
              const resolvedChatId = extractChatId(payload);
              if (!resolvedChatId) {
                log.warn({ payloadKeys: Object.keys(payload) }, "bot.added missing chatId");
                return;
              }
              const existing = resolveProjectByChatId(ctx.api, resolvedChatId);
              if (existing) {
                if (existing.status === "disabled") {
                  await ctx.api.reactivateProject({ projectId: existing.id, actorId: "system" });
                }
                await feishuAdapter.sendInteractiveCard(resolvedChatId, feishuPlatformOutput.buildProjectResumedCard(existing));
                return;
              }
              const unbound = ctx.api.listUnboundProjects();
              await feishuAdapter.sendInteractiveCard(resolvedChatId, feishuPlatformOutput.buildInitCard(unbound.length > 0 ? unbound : undefined));
            } catch (error) {
              log.error({ err: error instanceof Error ? error.message : error }, "bot.added error");
            }
          },
          onBotRemoved: async (data) => {
            try {
              const payload = data as Record<string, unknown>;
              const resolvedChatId = extractChatId(payload);
              if (!resolvedChatId) return;
              const project = resolveProjectByChatId(ctx.api, resolvedChatId);
              if (project) {
                await ctx.api.disableProject({ projectId: project.id, actorId: "system" });
              }
            } catch (error) {
              log.error({ err: error instanceof Error ? error.message : error }, "bot.removed error");
            }
          },
          onMemberJoined: async (data) => {
            try {
              const event = data as Record<string, unknown>;
              const chatId = extractChatId(event);
              const users = Array.isArray(event.users) ? event.users as Array<Record<string, unknown>> : [];
              if (!chatId || users.length === 0) return;
              const project = resolveProjectByChatId(ctx.api, chatId);
              if (!project) return;
              for (const u of users) {
                const userId = extractOpenId(u, "user_id") || (typeof u.open_id === "string" ? u.open_id : "");
                if (userId) {
                  ctx.api.resolveRole({ userId, projectId: project.id });
                }
              }
            } catch (error) {
              log.error({ err: error instanceof Error ? error.message : error }, "member.joined error");
            }
          },
          onBotMenuEvent: async (data) => {
            try {
              const event = data as Record<string, unknown>;
              const eventKey = String(event.event_key ?? "");
              const openId = extractOpenId(event, "operator");
              if (!openId || !ctx.api.isAdmin(openId)) return;
              if (eventKey === "admin_menu_event") {
                const card = feishuPlatformOutput.buildAdminHelpCard();
                await feishuAdapter.sendInteractiveCard(openId, card, "open_id");
              }
            } catch (error) {
              log.error({ err: error instanceof Error ? error.message : error }, "bot.menu error");
            }
          }
        });
        runtime.wsClient = await wsApp.start();
      },
      stop: async () => {}
    };

    return runtime;
  }
}
