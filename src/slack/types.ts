/**
 * @module src/slack/types
 * @layer Slack (platform-specific)
 *
 * Slack platform handler dependencies.
 */
import type { CoreDeps } from "../../services/orchestrator/src/handler-types";
import type { SlackMessageClient, SlackOutputAdapter } from "./channel/index";
import type { AuditService } from "../../services/orchestrator/src/audit/index";

export type SlackMessageClientPort = Pick<
  SlackMessageClient,
  | "postMessage"
  | "updateMessage"
  | "startStream"
  | "appendStream"
  | "stopStream"
  | "addReaction"
>;

export interface SlackHandlerDeps extends CoreDeps {
  slackMessageClient: SlackMessageClientPort;
  platformOutput: SlackOutputAdapter;
  recentEventIds: Set<string>;
  eventDedupTtlMs: number;
  auditService?: AuditService;
}
