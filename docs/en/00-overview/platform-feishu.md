---
title: "Feishu Integration"
layer: overview
status: active
source_of_truth: src/feishu/*, src/feishu/channel/*, scripts/export-feishu-scopes.ts
---

# Feishu Integration

Feishu / Lark is currently the primary platform for the system, and it is integrated via WebSocket Stream mode.

## Understand the integration first

| Item | Current implementation |
| --- | --- |
| Event intake | WebSocket Stream |
| Main entry point | `src/feishu/feishu-ws-app.ts` |
| Bot interactions | messages, cards, bot menu |
| Platform output | `src/feishu/channel/*` |

```mermaid
flowchart LR
  A[Feishu Event] --> B[src/feishu/*]
  B --> C[src/common/dispatcher.ts]
  C --> D[orchestrator]
  D --> E[FeishuOutputAdapter]
```

Feishu Open Platform entry:

- https://open.feishu.cn/app

## Create the app

Recommended sequence:

| Step | Action |
| --- | --- |
| 1 | Create an internal enterprise app in the Feishu Open Platform |
| 2 | Enable bot capability |
| 3 | Get the `App ID` and `App Secret` |
| 4 | Grant the required permissions |
| 5 | Configure event subscriptions |
| 6 | Configure app visibility and publish |
| 7 | Add the app to a group chat or enable 1:1 chat usage |

```mermaid
flowchart LR
  A[Create App] --> B[Enable Bot]
  B --> C[Configure Permissions]
  C --> D[Configure Events]
  D --> E[Publish]
  E --> F[Add to Group Chat]
```

## Environment variables

| Variable | Description |
| --- | --- |
| `FEISHU_APP_ID` | App ID |
| `FEISHU_APP_SECRET` | App secret |
| `FEISHU_SIGNING_SECRET` | Event signing secret; usually optional in Stream mode |
| `FEISHU_ENCRYPT_KEY` | Encryption support for encrypted events |
| `FEISHU_API_BASE_URL` | Defaults to `https://open.feishu.cn/open-apis` |

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_SIGNING_SECRET=
FEISHU_ENCRYPT_KEY=
FEISHU_API_BASE_URL=https://open.feishu.cn/open-apis
```

## Permissions

The following permissions are based on the permission list you provided and are shown here as tenant-level scopes.

| Permission | Purpose |
| --- | --- |
| `cardkit:card:write` | Create and update cards |
| `contact:contact.base:readonly` | Read basic contact directory data |
| `contact:user.base:readonly` | Read basic user info |
| `im:chat` | Access chat-level capabilities |
| `im:chat.members:read` | Read group member lists |
| `im:chat.menu_tree:read` | Read chat menu trees |
| `im:chat.menu_tree:write_only` | Write chat menu trees |
| `im:chat.top_notice:write_only` | Write top notices in chats |
| `im:chat.widgets:read` | Read chat widgets |
| `im:chat.widgets:write_only` | Write chat widgets |
| `im:chat:readonly` | Read chat info |
| `im:message` | Read and send messages |
| `im:message.group_at_msg:readonly` | Read group mentions to the bot |
| `im:message.group_msg` | Handle group messages |
| `im:message.p2p_msg:readonly` | Read direct messages |
| `im:message:send_as_bot` | Send messages as the app/bot |

If you want to configure the app directly, use:

- https://open.feishu.cn/app

## Event subscriptions

Based on the event configuration screenshot you provided, the current event subscriptions should include:

| Event | Purpose |
| --- | --- |
| `im.message.receive_v1` | Receive user messages |
| `card.action.trigger` | Receive card callbacks |
| `im.chat.member.bot.added_v1` | Bot added to group chat |
| `im.chat.member.bot.deleted_v1` | Bot removed from group chat |
| `im.chat.member.user.added_v1` | New member joined the group chat |
| `application.bot.menu_v6` | Bot menu event |

For callbacks, the required entry is:

| Callback | Purpose |
| --- | --- |
| `card.action.trigger` | Receive interactive card callbacks |

Your callback screenshot also shows `url.preview.get` and `profile.view.get`, but they are not required for the current main path.

## Visibility and release

| Setting | Recommendation |
| --- | --- |
| App visibility | Include the users and groups that need the bot |
| Version publishing | Publish the app version after permissions and events are ready |
| Group capability | Add the bot to the target group chats |
| Direct-message capability | Confirm the app allows 1:1 chat with the bot |

## Minimal validation checklist

| Check | Expected result |
| --- | --- |
| Bot can join a group chat | The bot is visible in the group |
| User messages trigger events | `im.message.receive_v1` works |
| Card buttons call back successfully | `card.action.trigger` works |
| Bot menu triggers work | `application.bot.menu_v6` works |
| Bot can send messages / update cards | Output path is functioning |

```bash
npm run start:dev
tail -f data/logs/app.log
```
