import { routeIntent } from "../../../../packages/channel-core/src/intent-router";
import { ChannelError } from "../../../../packages/channel-core/src/errors";
import type { ChannelAdapter } from "../../../../packages/channel-core/src/channel-adapter";
import { authorizeIntent } from "../../../iam/src/command-guard";
import type { EffectiveRole } from "../../../iam/src/permissions";

import type { ConversationOrchestrator } from "../orchestrator";
import type { HandleIntentResult } from "./result";
import { shouldRouteToAgent } from "../../../../packages/channel-core/src/intent-router";

export interface InboundWebhookParams {
  adapter: Pick<ChannelAdapter, "verifyWebhook" | "parseInboundEvent" | "sendMessage">;
  orchestrator: Pick<ConversationOrchestrator, "handleIntent">;
  projectId: string;
  role: EffectiveRole;
  headers: Record<string, string>;
  body: string;
  payload: unknown;
  errorMessage?: string;
}

export type InboundWebhookResult =
  | { ok: true; result: HandleIntentResult | { mode: "noop"; id: string } }
  | { ok: false; error: "signature_invalid" | "event_expired" | "event_replayed" | "handler_failed"; retriable: boolean };

export async function handleInboundWebhook(
  params: InboundWebhookParams
): Promise<InboundWebhookResult> {
  try {
    params.adapter.verifyWebhook(params.headers, params.body);
  } catch (error) {
    if (error instanceof ChannelError) {
      if (error.code === "CHANNEL_EVENT_EXPIRED") {
        return { ok: false, error: "event_expired", retriable: false };
      }
      if (error.code === "CHANNEL_EVENT_REPLAYED") {
        return { ok: false, error: "event_replayed", retriable: false };
      }
    }
    return { ok: false, error: "signature_invalid", retriable: false };
  }
  const message = params.adapter.parseInboundEvent(params.payload);
  const intent = routeIntent(message);
  authorizeIntent(params.role, intent.intent);

  if (!shouldRouteToAgent(intent.intent, message.type)) {
    return {
      ok: true,
      result: {
        mode: "noop",
        id: intent.intent
      }
    };
  }

  const inputText = message.type === "text" || message.type === "command" ? message.text : "";
  try {
    const result = await params.orchestrator.handleIntent(
      params.projectId,
      message.chatId,
      intent,
      inputText,
      message.traceId,
      message.userId
    );
    return { ok: true, result };
  } catch {
    await params.adapter.sendMessage({
      chatId: message.chatId,
      text: params.errorMessage ?? "系统繁忙，请稍后重试"
    });
    return { ok: false, error: "handler_failed", retriable: true };
  }
}
