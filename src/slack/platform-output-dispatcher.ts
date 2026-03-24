import type { PlatformOutput, OutputGateway } from "../common/platform-output";
import { SlackRenderer } from "./channel/index";
import type { SlackHelpPanelPayload } from "./shared-handlers";
import type { SlackHandlerDeps } from "./types";
import { CardDispatchCoordinator } from "../common/card-dispatch-coordinator";

export class SlackOutputGateway implements OutputGateway {
  private readonly renderer = new SlackRenderer();
  private readonly coordinator = new CardDispatchCoordinator();

  constructor(private readonly deps: SlackHandlerDeps) {}

  private async resolveChatId(targetId: string): Promise<string> {
    return (await this.deps.api.getProjectRecord(targetId))?.chatId || targetId;
  }

  async dispatch(targetId: string, output: PlatformOutput): Promise<void> {
    const chatId = await this.resolveChatId(targetId);
    this.coordinator.enqueue(this.cardKey(chatId, output), async () => {
      await this.dispatchNetwork(chatId, output);
    });
  }

  async flushAll(): Promise<void> {
    await this.coordinator.flushAll();
  }

  private cardKey(chatId: string, output: PlatformOutput): string {
    switch (output.kind) {
      case "content":
      case "reasoning":
      case "plan":
      case "plan_update":
      case "tool_output":
      case "progress":
      case "turn_summary":
        return `slack:turn:${chatId}:${output.data.turnId}`;
      case "notification":
        return output.data.turnId ? `slack:turn:${chatId}:${output.data.turnId}` : `slack:notify:${chatId}:${Date.now()}:${Math.random()}`;
      case "approval_request":
        return `slack:approval:${chatId}:${output.data.approvalId}`;
      case "user_input_request":
        return `slack:user-input:${chatId}:${output.data.turnId}:${output.data.callId}`;
      case "platform_mutation":
        return output.data.messageId
          ? `slack:message:${output.data.chatId || chatId}:${output.data.messageId}`
          : `slack:chat:${output.data.chatId || chatId}:raw-card`;
      default:
        return `slack:${output.kind}:${chatId}:${Date.now()}:${Math.random()}`;
    }
  }

  private async dispatchNetwork(chatId: string, output: PlatformOutput): Promise<void> {
    switch (output.kind) {
      case "content":
        await this.deps.platformOutput.appendContent(chatId, output.data.turnId, output.data.delta);
        return;
      case "reasoning":
        await this.deps.platformOutput.appendReasoning(chatId, output.data.turnId, output.data.delta);
        return;
      case "plan":
        await this.deps.platformOutput.appendPlan(chatId, output.data.turnId, output.data.delta);
        return;
      case "plan_update":
        if (this.deps.platformOutput.updatePlan) {
          await this.deps.platformOutput.updatePlan(chatId, output.data);
          return;
        }
        await this.deps.platformOutput.appendPlan(
          chatId,
          output.data.turnId,
          [output.data.explanation, ...output.data.plan.map((item) => `${item.status}: ${item.step}`)]
            .filter(Boolean)
            .join("\n")
        );
        return;
      case "tool_output":
        await this.deps.platformOutput.appendToolOutput(chatId, output.data);
        return;
      case "progress":
        await this.deps.platformOutput.updateProgress(chatId, output.data);
        return;
      case "notification": {
        const rendered = this.renderer.renderNotification(output.data);
        await this.deps.slackMessageClient.postMessage({ channel: chatId, blocks: rendered.blocks, text: rendered.text });
        return;
      }
      case "thread_operation":
        await this.deps.platformOutput.sendThreadOperation(chatId, output.data);
        return;
      case "snapshot_operation":
        await this.deps.platformOutput.sendSnapshotOperation(chatId, output.data, output.userId);
        return;
      case "config_operation":
        await this.deps.platformOutput.sendConfigOperation(chatId, output.data, output.userId);
        return;
      case "skill_operation":
        await this.deps.platformOutput.sendSkillOperation(chatId, output.data);
        return;
      case "thread_new_form":
        await this.deps.platformOutput.sendThreadNewForm(chatId, output.data);
        return;
      case "approval_request":
        await this.deps.platformOutput.requestApproval(chatId, output.data);
        return;
      case "user_input_request":
        await this.deps.platformOutput.requestUserInput(chatId, output.data);
        return;
      case "turn_summary":
        await this.deps.platformOutput.completeTurn(chatId, output.data);
        return;
      case "error": {
        const rendered = this.renderer.renderNotification({
          kind: "notification",
          threadId: "",
          turnId: output.data.turnId,
          category: "error",
          title: output.data.code,
          detail: output.data.message,
        });
        await this.deps.slackMessageClient.postMessage({ channel: chatId, blocks: rendered.blocks, text: rendered.text });
        return;
      }
      case "merge_event":
        if (output.data.action === "resolver_done") {
          await this.deps.platformOutput.sendFileReview(chatId, output.data.review);
          return;
        }
        if (output.data.action === "resolver_complete") {
          await this.deps.platformOutput.sendMergeOperation(chatId, output.data.operation);
          return;
        }
        await this.deps.platformOutput.notify(chatId, {
          kind: "notification",
          threadId: "",
          category: "warning",
          title: "⏰ 合并审阅已超时",
          detail: `分支 ${output.data.branchName} 的合并审阅已超时，已自动取消`,
        });
        return;
      case "help_panel":
        if (isSlackHelpPanelPayload(output.panel)) {
          if (output.panel.messageTs) {
            await this.deps.slackMessageClient.updateMessage({
              channel: chatId,
              ts: output.panel.messageTs,
              blocks: output.panel.blocks as Parameters<typeof this.deps.slackMessageClient.updateMessage>[0]["blocks"],
              text: output.panel.text
            });
            return;
          }
          await this.deps.slackMessageClient.postMessage({
            channel: chatId,
            blocks: output.panel.blocks as Parameters<typeof this.deps.slackMessageClient.postMessage>[0]["blocks"],
            text: output.panel.text
          });
        }
        return;
      case "turn_detail":
      case "admin_panel":
        return;
      case "platform_mutation": {
        const payload = output.data.payload;
        if (!payload || typeof payload !== "object") {
          return;
        }
        if (isSlackHelpPanelPayload(payload)) {
          if (output.data.messageId) {
            await this.deps.slackMessageClient.updateMessage({
              channel: output.data.chatId || chatId,
              ts: output.data.messageId,
              blocks: payload.blocks as Parameters<typeof this.deps.slackMessageClient.updateMessage>[0]["blocks"],
              text: payload.text,
            });
            return;
          }
          await this.deps.slackMessageClient.postMessage({
            channel: output.data.chatId || chatId,
            blocks: payload.blocks as Parameters<typeof this.deps.slackMessageClient.postMessage>[0]["blocks"],
            text: payload.text,
          });
        }
        return;
      }
    }
  }
}

function isSlackHelpPanelPayload(value: unknown): value is SlackHelpPanelPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SlackHelpPanelPayload>;
  return Array.isArray(candidate.blocks) && typeof candidate.text === "string";
}
