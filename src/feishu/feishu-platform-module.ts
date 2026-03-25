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

async function syncChatMembersBackground(
  adapter: FeishuAdapter,
  api: PlatformModuleContext["api"],
  chatId: string,
  projectId: string
): Promise<void> {
  log.info({ chatId, projectId }, "syncChatMembersBackground: started");
  try {
    const memberIds = await adapter.listChatMembers(chatId);
    log.info({ chatId, projectId, memberCount: memberIds.length, memberIds: memberIds.slice(0, 20) }, "syncChatMembersBackground: listChatMembers result");
    if (!memberIds.length) return;
    for (const uid of memberIds) {
      log.info({ uid, projectId }, "syncChatMembersBackground: ensuring project member");
      await api.ensureProjectMember({ userId: uid, projectId, defaultRole: "auditor" });
    }
    log.info({ projectId, count: memberIds.length }, "syncChatMembersBackground: synced all members");
  } catch (err) {
    log.warn({ projectId, chatId, err: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, "syncChatMembersBackground: failed");
  }
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
      cardThrottleMs: ctx.config.feishu.cardUpdateIntervalMs,
      deliveryMode: ctx.config.feishu.cardDeliveryMode,
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
            log.info({ dataKeys: Object.keys(data ?? {}) }, "bot.added: handler entered");
            try {
              const payload = data as Record<string, unknown>;
              log.info({ payload: JSON.stringify(payload).slice(0, 1000) }, "bot.added: raw payload");
              const resolvedChatId = extractChatId(payload);
              log.info({ resolvedChatId, hasChatId: !!resolvedChatId }, "bot.added: extractChatId result");
              if (!resolvedChatId) {
                log.warn({ payloadKeys: Object.keys(payload) }, "bot.added missing chatId");
                return;
              }
              const existing = await resolveProjectByChatId(ctx.api, resolvedChatId);
              log.info({ resolvedChatId, existingProject: existing ? { id: existing.id, status: existing.status, name: existing.name } : null }, "bot.added: project lookup result");
              if (existing) {
                if (existing.status === "disabled") {
                  log.info({ projectId: existing.id }, "bot.added: reactivating disabled project");
                  await ctx.api.reactivateProject({ projectId: existing.id, actorId: "system" });
                }
                await feishuAdapter.sendInteractiveCard(resolvedChatId, feishuPlatformOutput.buildProjectResumedCard(existing));
                log.info({ projectId: existing.id, chatId: resolvedChatId }, "bot.added: starting member sync");
                void syncChatMembersBackground(feishuAdapter, ctx.api, resolvedChatId, existing.id);
                return;
              }
              log.info({ resolvedChatId }, "bot.added: no existing project, sending init card");
              const unbound = await ctx.api.listUnboundProjects();
              await feishuAdapter.sendInteractiveCard(resolvedChatId, feishuPlatformOutput.buildInitCard(unbound.length > 0 ? unbound : undefined));
            } catch (error) {
              log.error({ err: error instanceof Error ? error.message : error, stack: error instanceof Error ? error.stack : undefined }, "bot.added error");
            }
          },
          onBotRemoved: async (data) => {
            log.info({ dataKeys: Object.keys(data ?? {}) }, "bot.removed: handler entered");
            try {
              const payload = data as Record<string, unknown>;
              const resolvedChatId = extractChatId(payload);
              log.info({ resolvedChatId }, "bot.removed: extractChatId result");
              if (!resolvedChatId) return;
              const project = await resolveProjectByChatId(ctx.api, resolvedChatId);
              if (project) {
                log.info({ projectId: project.id }, "bot.removed: disabling project");
                await ctx.api.disableProject({ projectId: project.id, actorId: "system" });
              }
            } catch (error) {
              log.error({ err: error instanceof Error ? error.message : error }, "bot.removed error");
            }
          },
          onMemberJoined: async (data) => {
            log.info({ dataKeys: Object.keys(data ?? {}) }, "member.joined: handler entered");
            try {
              const event = data as Record<string, unknown>;
              const chatId = extractChatId(event);
              const users = Array.isArray(event.users) ? event.users as Array<Record<string, unknown>> : [];
              log.info({ chatId, userCount: users.length, rawUsers: JSON.stringify(users).slice(0, 500) }, "member.joined: parsed event");
              if (!chatId || users.length === 0) return;
              const project = await resolveProjectByChatId(ctx.api, chatId);
              log.info({ chatId, projectId: project?.id ?? null }, "member.joined: project lookup");
              if (!project) return;
              for (const u of users) {
                const userId = extractOpenId(u, "user_id") || (typeof u.open_id === "string" ? u.open_id : "");
                if (userId) {
                  log.info({ userId, projectId: project.id }, "member.joined: ensuring project member");
                  await ctx.api.ensureProjectMember({ userId, projectId: project.id, defaultRole: "auditor" });
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
              if (!openId || !await ctx.api.isAdmin(openId)) return;
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
