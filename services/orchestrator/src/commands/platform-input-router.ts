import type { PlatformInput } from "../../../contracts/im/platform-input";

export interface PlatformInputMessageHandler<Deps> {
  handleMessage(deps: Deps, input: Extract<PlatformInput, { kind: "message" }>): Promise<void>;
}

export class PlatformInputRouter<Deps> {
  constructor(private readonly messageHandler: PlatformInputMessageHandler<Deps>) {}

  async route(deps: Deps, input: PlatformInput): Promise<void> {
    if (input.kind === "message") {
      await this.messageHandler.handleMessage(deps, input);
    }
  }
}
