import { FetchSlackClient, SlackOutputAdapter } from "./channel/index";
import { ConfigError } from "../config";
import { handleSlackAction } from "./slack-action-handler";
import { handleSlackMessage } from "./slack-message-handler";
import { SlackOutputGateway } from "./platform-output-dispatcher";
import { SlackSocketModeApp } from "./slack-socket-mode-app";
import type { SlackHandlerDeps } from "./types";
import type { BootstrappedPlatformRuntime, PlatformModule, PlatformModuleContext } from "../platform/types";

export class SlackPlatformModule implements PlatformModule {
  readonly platformId = "slack" as const;

  async bootstrap(ctx: PlatformModuleContext): Promise<BootstrappedPlatformRuntime> {
    if (!ctx.config.slack) {
      throw new ConfigError("slack platform bootstrap is incomplete");
    }

    const slackMessageClient = new FetchSlackClient(ctx.config.slack.botToken);
    // Construct the SlackOutputAdapter internally — it's a private implementation detail
    const slackPlatformOutput = new SlackOutputAdapter(slackMessageClient);

    const deps: SlackHandlerDeps = {
      config: ctx.config,
      slackMessageClient,
      platformOutput: slackPlatformOutput,
      orchestrator: ctx.layer.orchestrator,
      pluginService: ctx.layer.pluginService,
      approvalHandler: ctx.layer.approvalHandler,
      adminStateStore: ctx.persistence.adminStateStore,
      findProjectByChatId: ctx.layer.findProjectByChatId,
      userRepository: ctx.persistence.userRepo,
      recentEventIds: new Set<string>(),
      eventDedupTtlMs: 60_000,
      roleResolver: ctx.layer.roleResolver,
      auditService: ctx.layer.auditService,
    };

    const slackApp = new SlackSocketModeApp({
      appToken: ctx.config.slack.appToken,
      onInboundMessage: (input) => handleSlackMessage(deps, input),
      onAction: (input) => handleSlackAction(deps, input)
    });

    return {
      platform: "slack",
      output: new SlackOutputGateway(deps),
      slackApp,
      start: async () => {
        await slackApp.start();
      },
      stop: async () => {
        await slackApp.stop();
      }
    };
  }
}
