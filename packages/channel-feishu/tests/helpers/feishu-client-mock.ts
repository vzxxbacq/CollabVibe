import { vi } from "vitest";

export interface FeishuClientMock {
  sendMessage: ReturnType<typeof vi.fn<(payload: unknown) => Promise<string>>>;
  sendInteractiveCard: ReturnType<typeof vi.fn<(chatId: string, card: Record<string, unknown>) => Promise<string>>>;
  updateInteractiveCard: ReturnType<typeof vi.fn<(cardToken: string, card: Record<string, unknown>) => Promise<void>>>;
  pinMessage: ReturnType<typeof vi.fn<(messageId: string) => Promise<void>>>;
}

export function makeFeishuClientMock(): FeishuClientMock {
  return {
    sendMessage: vi.fn(async () => "msg-1"),
    sendInteractiveCard: vi.fn(async () => "card-token-1"),
    updateInteractiveCard: vi.fn(async () => undefined),
    pinMessage: vi.fn(async () => undefined)
  };
}
