// ─────────────────────────────────────────────────────────────────────────────
// @codex-im/channel-slack — Public exports
// ─────────────────────────────────────────────────────────────────────────────

export { SlackOutputAdapter } from "./slack-output-adapter";
export {
    FetchSlackClient,
    type SlackBlock,
    type SlackMessageClient,
    type SlackPostResult,
    type SlackStreamResult
} from "./slack-message-client";
export {
    SlackSocketHandler,
    type ActionHandler,
    type MessageHandler,
    type SlackActionPayload,
    type SlackEventPayload,
    type SlackSocketEvent
} from "./slack-socket-handler";
export {
    type ProgressEntry,
    actions,
    applyProgressEvent,
    buildApprovalBlocks,
    buildCompletedActions,
    buildDiffBlocks,
    buildNotificationBlocks,
    buildProgressBlocks,
    buildRunningActions,
    buildSummaryBlocks,
    buildUserInputBlocks,
    codeBlock,
    context,
    divider,
    header,
    section
} from "./slack-block-builder";
export { SlackInboundAdapter } from "./slack-inbound-adapter";
export { SlackActionAdapter } from "./slack-action-adapter";
export { SlackRenderer } from "./slack-renderer";
