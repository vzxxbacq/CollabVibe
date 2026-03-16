import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { FeishuAdapter } from "../packages/channel-feishu/src/feishu-adapter";
import { FetchHttpClient } from "../packages/channel-feishu/src/fetch-http-client";
import { TurnCardManager } from "../packages/channel-feishu/src/feishu-turn-card";

type ArgMap = Record<string, string | boolean>;

function parseArgs(argv: string[]): ArgMap {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function stringifyError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const maybe = error as Error & { status?: number; code?: number; details?: unknown };
    return {
      name: error.name,
      message: error.message,
      status: maybe.status,
      code: maybe.code,
      details: maybe.details
    };
  }
  return { error: String(error) };
}

function usage(): never {
  console.error([
    "Usage:",
    "  npx tsx scripts/diag-feishu-card.mts --chat-id <chatId> [--send] [--stream]",
    "",
    "Environment:",
    "  FEISHU_APP_ID / FEISHU_APP_SECRET must be set",
    "",
    "Examples:",
    "  npx tsx scripts/diag-feishu-card.mts --chat-id oc_xxx --send --stream",
    "  npx tsx scripts/diag-feishu-card.mts --chat-id oc_xxx --message \"hello\" --reasoning \"thinking\""
  ].join("\n"));
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args["chat-id"]) usage();
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
    throw new Error("missing FEISHU_APP_ID or FEISHU_APP_SECRET");
  }
  const httpClient = new FetchHttpClient({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    apiBaseUrl: process.env.FEISHU_API_BASE_URL ?? "https://open.feishu.cn/open-apis"
  });
  const feishu = new FeishuAdapter({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    signingSecret: process.env.FEISHU_SIGNING_SECRET ?? "",
    httpClient
  });

  const chatId = String(args["chat-id"]);
  const turnId = String(args["turn-id"] ?? `diag-${Date.now()}`);
  const threadName = String(args["thread"] ?? "__main__");
  const backend = String(args["backend"] ?? "codex");
  const model = String(args["model"] ?? "diagnostic-model");
  const message = String(args["message"] ?? "");
  const reasoning = String(args["reasoning"] ?? "");
  const streamText = String(args["stream-text"] ?? "Hello from native stream diagnostic.");

  const turnCard = new TurnCardManager({
    sendMessage: async () => "noop-msg",
    sendInteractiveCard: async () => "noop-card",
    updateInteractiveCard: async () => undefined,
    createCardEntity: async () => "noop-entity",
    sendCardEntity: async () => "noop-message",
    updateCardSettings: async () => undefined,
    streamCardElement: async () => undefined,
    updateCardElement: async () => undefined
  }, { cardThrottleMs: 0 });

  turnCard.setCardThreadName(chatId, turnId, threadName);
  turnCard.setCardBackendInfo(chatId, turnId, backend, model);
  const state = turnCard.getOrCreateState(chatId, turnId);
  state.message = message;
  state.thinking = reasoning;

  const streamingCard = (turnCard as unknown as { renderStreamingCard: (s: typeof state) => Record<string, unknown> }).renderStreamingCard(state);
  const outPath = join("/tmp", `feishu-card-diag-${Date.now()}.json`);
  await writeFile(outPath, JSON.stringify(streamingCard, null, 2), "utf8");

  console.log(JSON.stringify({
    step: "prepared",
    chatId,
    turnId,
    outPath,
    cardSummary: {
      schema: streamingCard.schema,
      bodyElementCount: Array.isArray((streamingCard.body as { elements?: unknown[] } | undefined)?.elements)
        ? ((streamingCard.body as { elements?: unknown[] }).elements?.length ?? 0)
        : 0
    }
  }, null, 2));

  let cardId = "";
  try {
    cardId = await feishu.createCardEntity(streamingCard);
    console.log(JSON.stringify({ step: "createCardEntity", ok: true, cardId }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      step: "createCardEntity",
      ok: false,
      error: stringifyError(error),
      outPath
    }, null, 2));
    process.exit(2);
  }

  if (args.send) {
    try {
      const messageId = await feishu.sendCardEntity(chatId, cardId);
      console.log(JSON.stringify({ step: "sendCardEntity", ok: true, messageId, chatId, cardId }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({
        step: "sendCardEntity",
        ok: false,
        chatId,
        cardId,
        error: stringifyError(error)
      }, null, 2));
      process.exit(3);
    }
  }

  if (args.stream) {
    try {
      await feishu.streamCardElement(cardId, "turn_msg", streamText, 1);
      console.log(JSON.stringify({
        step: "streamCardElement",
        ok: true,
        cardId,
        elementId: "turn_msg",
        sequence: 1,
        contentLength: streamText.length
      }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({
        step: "streamCardElement",
        ok: false,
        cardId,
        elementId: "turn_msg",
        sequence: 1,
        error: stringifyError(error)
      }, null, 2));
      process.exit(4);
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ step: "fatal", error: stringifyError(error) }, null, 2));
  process.exit(10);
});
