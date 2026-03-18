/**
 * @module src/slack/slack-socket-mode-app
 * @layer Slack (platform-specific)
 *
 * Minimal Slack Socket Mode bootstrap.
 */
import { createLogger } from "../../packages/logger/src/index";
import { SlackSocketHandler, type SlackSocketEvent } from "./channel/index";
import type { SlackInboundAction } from "./slack-action-handler";
import type { SlackInboundMessage } from "./slack-message-handler";

const log = createLogger("slack-socket-mode");

interface SlackOpenConnectionResponse {
  ok: boolean;
  url?: string;
  error?: string;
}

export interface SlackSocketModeAppOptions {
  appToken: string;
  onInboundMessage: (input: SlackInboundMessage) => Promise<void>;
  onAction: (input: SlackInboundAction) => Promise<void>;
}

export class SlackSocketModeApp {
  private readonly handler = new SlackSocketHandler();
  private socket: WebSocket | null = null;
  private stopped = false;

  constructor(private readonly options: SlackSocketModeAppOptions) {
    this.handler.onMessage(async (params) => {
      await this.options.onInboundMessage(params);
    });
    this.handler.onAction(async (params) => {
      await this.options.onAction(params);
    });
  }

  private async openConnectionUrl(): Promise<string> {
    let response: Response;
    try {
      response = await fetch("https://slack.com/api/apps.connections.open", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.appToken}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      });
    } catch (error) {
      const cause = error instanceof Error && "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
      const causeMessage = cause instanceof Error
        ? cause.message
        : typeof cause === "object" && cause && "code" in (cause as Record<string, unknown>)
          ? String((cause as Record<string, unknown>).code)
          : undefined;
      throw new Error(
        `Slack Socket Mode connection open failed: ${error instanceof Error ? error.message : String(error)}${causeMessage ? ` (${causeMessage})` : ""}`
      );
    }
    if (!response.ok) {
      throw new Error(`Slack apps.connections.open HTTP ${response.status}`);
    }
    const body = await response.json() as SlackOpenConnectionResponse;
    if (!body.ok || !body.url) {
      throw new Error(`Slack apps.connections.open failed: ${body.error ?? "missing url"}`);
    }
    return body.url;
  }

  private ack(envelopeId: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify({ envelope_id: envelopeId }));
  }

  private handleSocketMessage(raw: string): void {
    let event: SlackSocketEvent | { type?: string; envelope_id?: string };
    try {
      event = JSON.parse(raw) as SlackSocketEvent | { type?: string; envelope_id?: string };
    } catch (error) {
      log.warn({ err: error instanceof Error ? error.message : String(error) }, "failed to parse slack socket payload");
      return;
    }

    if (!("type" in event) || typeof event.type !== "string") {
      return;
    }
    if (event.type === "hello") {
      log.info("slack socket hello");
      return;
    }
    if (event.type === "disconnect") {
      log.warn({ event }, "slack socket disconnect");
      return;
    }
    if (event.type !== "events_api" && event.type !== "interactive") {
      return;
    }

    const typedEvent = event as SlackSocketEvent;
    this.ack(typedEvent.envelope_id);
    void this.handler.handleEvent(typedEvent).catch((error) => {
      log.error({ err: error instanceof Error ? error.message : String(error), envelopeId: typedEvent.envelope_id }, "slack socket event handler failed");
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    const url = await this.openConnectionUrl();
    const socket = new WebSocket(url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => {
        log.info("slack socket connected");
        resolve();
      }, { once: true });
      socket.addEventListener("error", (event) => {
        reject(new Error(`Slack socket error: ${String((event as Event).type)}`));
      }, { once: true });
    });

    socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      this.handleSocketMessage(raw);
    });

    socket.addEventListener("close", () => {
      log.warn("slack socket closed");
      this.socket = null;
      if (!this.stopped) {
        void this.start().catch((error) => {
          log.error({ err: error instanceof Error ? error.message : String(error) }, "slack socket reconnect failed");
        });
      }
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (!this.socket) {
      return;
    }
    const socket = this.socket;
    this.socket = null;
    socket.close();
  }
}
