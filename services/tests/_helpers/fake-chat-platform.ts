import type { PlatformOutput } from "../../event/output-contracts";

export interface ChatMessageInput {
  chatId: string;
  userId: string;
  text: string;
  traceId?: string;
}

export interface ChatActionInput {
  chatId: string;
  userId: string;
  kind: "approval_decision" | "user_input_reply";
  payload: Record<string, unknown>;
}

export interface CapturedChatEvent {
  chatId: string;
  projectId: string;
  output: PlatformOutput;
}

export class FakeChatPlatform {
  private readonly outputs: CapturedChatEvent[] = [];
  private readonly messages: ChatMessageInput[] = [];
  private readonly actions: ChatActionInput[] = [];

  recordMessage(input: ChatMessageInput): void {
    this.messages.push(input);
  }

  recordAction(input: ChatActionInput): void {
    this.actions.push(input);
  }

  recordOutput(event: CapturedChatEvent): void {
    this.outputs.push(event);
  }

  listOutputs(chatId?: string): CapturedChatEvent[] {
    return chatId ? this.outputs.filter((item) => item.chatId === chatId) : [...this.outputs];
  }

  listOutputKinds(chatId?: string): PlatformOutput["kind"][] {
    return this.listOutputs(chatId).map((item) => item.output.kind);
  }

  latestOutput(chatId?: string): CapturedChatEvent | undefined {
    const list = this.listOutputs(chatId);
    return list[list.length - 1];
  }

  clear(): void {
    this.outputs.length = 0;
    this.messages.length = 0;
    this.actions.length = 0;
  }
}
