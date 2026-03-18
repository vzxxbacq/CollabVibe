import { routeIntent } from "../../../contracts/im/intent-router";
import { ChannelError } from "../../../contracts/im/errors";
import type { ChannelAdapter } from "../../../contracts/im/channel-adapter";
import { authorizeIntent } from "../iam/command-guard";
import type { EffectiveRole } from "../../iam/permissions";
import { createLogger } from "../../../../packages/logger/src/index";

import type { ConversationOrchestrator } from "../orchestrator";
import type { HandleIntentResult } from "./result";
import { shouldRouteToAgent } from "../../../contracts/im/intent-router";

export interface InboundWebhookParams {
  adapter: Pick<ChannelAdapter, "verifyWebhook" | "parseInboundEvent">;
  orchestrator: Pick<ConversationOrchestrator, "handleIntent">;
  projectId: string;
  role: EffectiveRole;
  headers: Record<string, string>;
  body: string;
  payload: unknown;
}

export type InboundWebhookResult =
  | { ok: true; result: HandleIntentResult | { mode: "noop"; id: string } }
  | { ok: false; error: "signature_invalid" | "event_expired" | "event_replayed" | "handler_failed"; retriable: boolean };

const log = createLogger("inbound-webhook");

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
  } catch (error) {
    log.warn({
      projectId: params.projectId,
      chatId: message.chatId,
      traceId: message.traceId,
      err: error instanceof Error ? error.message : String(error)
    }, "handleIntent failed for inbound webhook");
    return { ok: false, error: "handler_failed", retriable: true };
  }
}
