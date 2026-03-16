import type { FeishuClientMock } from "./feishu-client-mock";

export function getSentCard(client: FeishuClientMock, index = 0): Record<string, unknown> {
  const call = client.sendInteractiveCard.mock.calls[index];
  if (!call) {
    throw new Error(`missing sendInteractiveCard call at index ${index}`);
  }
  return call[1];
}

export function getLastSentCard(client: FeishuClientMock): Record<string, unknown> {
  const call = client.sendInteractiveCard.mock.calls.at(-1);
  if (!call) {
    throw new Error("missing sendInteractiveCard call");
  }
  return call[1];
}

export function getUpdatedCard(client: FeishuClientMock, index = 0): Record<string, unknown> {
  const call = client.updateInteractiveCard.mock.calls[index];
  if (!call) {
    throw new Error(`missing updateInteractiveCard call at index ${index}`);
  }
  return call[1];
}

export function getLastUpdatedCard(client: FeishuClientMock): Record<string, unknown> {
  const call = client.updateInteractiveCard.mock.calls.at(-1);
  if (!call) {
    throw new Error("missing updateInteractiveCard call");
  }
  return call[1];
}

export function getUpdatedCardToken(client: FeishuClientMock, index = 0): string {
  const call = client.updateInteractiveCard.mock.calls[index];
  if (!call) {
    throw new Error(`missing updateInteractiveCard call at index ${index}`);
  }
  return call[0];
}
