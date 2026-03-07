import { routeIntent } from "../../../packages/channel-core/src/intent-router";
import type { ChannelAdapter } from "../../../packages/channel-core/src/channel-adapter";
import { authorizeIntent } from "../../iam/src/command-guard";
import type { Role } from "../../iam/src/permissions";

import type { ConversationOrchestrator } from "./orchestrator";

export interface InboundWebhookParams {
  adapter: Pick<ChannelAdapter, "verifyWebhook" | "parseInboundEvent" | "sendMessage">;
  orchestrator: Pick<ConversationOrchestrator, "handleIntent">;
  projectId: string;
  role: Role;
  headers: Record<string, string>;
  body: string;
  payload: unknown;
  errorMessage?: string;
}

export async function handleInboundWebhook(
  params: InboundWebhookParams
): Promise<{ ok: true; result: { mode: string; id: string } } | { ok: false; error: Error }> {
  params.adapter.verifyWebhook(params.headers, params.body);
  const message = params.adapter.parseInboundEvent(params.payload);
  const intent = routeIntent(message);
  authorizeIntent(params.role, intent.intent);

  const inputText = message.type === "text" || message.type === "command" ? message.text : "";
  try {
    const result = await params.orchestrator.handleIntent(
      params.projectId,
      message.chatId,
      intent,
      inputText,
      message.traceId
    );
    return { ok: true, result };
  } catch (error) {
    await params.adapter.sendMessage({
      chatId: message.chatId,
      text: params.errorMessage ?? "系统繁忙，请稍后重试"
    });
    return { ok: false, error: error as Error };
  }
}
