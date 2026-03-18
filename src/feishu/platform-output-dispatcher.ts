import type { PlatformOutput, OutputGateway } from "../../services/contracts/im/platform-output";
import { FeishuRenderer } from "./channel/index";
import type { FeishuHandlerDeps } from "./types";

export class FeishuOutputGateway implements OutputGateway {
  private readonly renderer = new FeishuRenderer();

  constructor(private readonly deps: FeishuHandlerDeps) {}

  async dispatch(chatId: string, output: PlatformOutput): Promise<void> {
    switch (output.kind) {
      case "text":
        await this.deps.feishuAdapter.sendMessage({ chatId, text: this.renderer.renderText(output.text) });
        return;
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
      case "notification":
        await this.deps.feishuAdapter.sendMessage({ chatId, text: this.renderer.renderNotification(output.data) });
        return;
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
      case "thread_merge":
        await this.deps.platformOutput.sendMergeOperation(chatId, output.data);
        return;
      case "merge_review":
        await this.deps.platformOutput.sendFileReview(chatId, output.data);
        return;
      case "merge_summary":
        await this.deps.platformOutput.sendMergeSummary(chatId, output.data);
        return;
      case "merge_timeout":
        await this.deps.platformOutput.notify(chatId, {
          kind: "notification",
          threadId: "",
          category: "warning",
          title: "⏰ 合并审阅已超时",
          detail: `分支 ${output.branchName} 的合并审阅已超时，已自动取消`,
        });
        return;
      case "help_panel":
        if (typeof output.panel === "object" && output.panel) {
          await this.deps.platformOutput.sendRawCard(chatId, output.panel as Record<string, unknown>);
        }
        return;
      case "turn_detail":
        if (typeof output.detail === "object" && output.detail) {
          await this.deps.platformOutput.sendRawCard(chatId, output.detail as Record<string, unknown>);
        }
        return;
      case "admin_panel":
        if (typeof output.panel === "object" && output.panel) {
          await this.deps.platformOutput.sendRawCard(chatId, output.panel as Record<string, unknown>);
        }
        return;
    }
  }
}
