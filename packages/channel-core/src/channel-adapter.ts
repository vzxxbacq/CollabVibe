import type { UnifiedMessage, UnifiedResponse } from "./types";

export interface IdentityRef {
  externalUserId: string;
  displayName?: string;
}

export interface ChannelAdapter {
  verifyWebhook(headers: Record<string, string>, body: string): void;
  parseInboundEvent(payload: unknown): UnifiedMessage;
  sendMessage(response: UnifiedResponse): Promise<string>;
  sendInteractiveCard(chatId: string, card: Record<string, unknown>): Promise<string>;
  updateInteractiveCard(cardToken: string, card: Record<string, unknown>): Promise<void>;
  resolveUserIdentity(userRef: string): Promise<IdentityRef>;
}

export abstract class BaseChannelAdapter implements ChannelAdapter {
  abstract verifyWebhook(headers: Record<string, string>, body: string): void;
  abstract parseInboundEvent(payload: unknown): UnifiedMessage;
  abstract sendMessage(response: UnifiedResponse): Promise<string>;
  abstract sendInteractiveCard(chatId: string, card: Record<string, unknown>): Promise<string>;
  abstract updateInteractiveCard(cardToken: string, card: Record<string, unknown>): Promise<void>;
  abstract resolveUserIdentity(userRef: string): Promise<IdentityRef>;
}
