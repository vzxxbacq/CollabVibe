export type ChannelErrorCode =
  | "CHANNEL_INVALID_SIGNATURE"
  | "CHANNEL_EVENT_EXPIRED"
  | "CHANNEL_EVENT_REPLAYED"
  | "CHANNEL_PARSE_FAILED"
  | "CHANNEL_REQUEST_FAILED";

export class ChannelError extends Error {
  readonly code: ChannelErrorCode;

  constructor(code: ChannelErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
