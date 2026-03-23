#!/usr/bin/env npx tsx
/**
 * 导出飞书应用所需权限列表
 *
 * 分析 codebase 中实际使用的飞书 API 和事件订阅，
 * 输出飞书开发者后台所需的权限配置 JSON。
 *
 * Usage:
 *   npx tsx scripts/export-feishu-scopes.ts
 *   npm run feishu:permissions
 */

interface ScopeManifest {
    scopes: {
        tenant: string[];
        user: string[];
    };
    events: Array<{ name: string; description: string }>;
    apis: Array<{ endpoint: string; description: string }>;
}

function buildManifest(): ScopeManifest {
    /*
     * ┌───────────────────────────────────────────────────────┐
     * │  权限（scopes） vs 事件（events） 是两个独立概念：     │
     * │  • scopes  → 在「权限管理」中开通                      │
     * │  • events  → 在「事件与回调」中订阅                    │
     * └───────────────────────────────────────────────────────┘
     *
     * 1. API 调用（均使用 tenant_access_token）：
     *    - POST  /im/v1/messages  → 发送文本/卡片消息
     *    - PATCH /im/v1/messages/{id}  → 更新互动卡片
     *    - POST  /im/v1/pins  → Pin 消息
     *    - GET   /contact/v3/users/{id}  → 获取用户信息（显示名）
     *
     * 2. 事件订阅（WebSocket Stream 接收）：
     *    - im.message.receive_v1              → 接收用户消息
     *    - card.action.trigger                → 接收卡片按钮回调（审批）
     *    - im.chat.member.bot.added_v1        → Bot 被拉入群聊
     *    - im.chat.member.user.added_v1       → 新用户加入群聊（自动注册）
     */

    return {
        scopes: {
            tenant: [
                // ── 消息 ──
                "im:message",                       // 获取与发送单聊、群组消息
                "im:message:send_as_bot",           // 以应用的身份发送消息

                // ── 卡片 ──
                "im:message:patch",                 // 编辑消息（更新互动卡片内容）
                "cardkit:card:read",                // 获取卡片信息、转换 ID
                "cardkit:card:write",               // 创建与更新卡片实体

                // ── Pin ──
                "im:message:pin",                   // Pin 消息（Turn 完成后 Pin 卡片）

                // ── 通讯录 ──
                "contact:user.base:readonly",      // 获取用户基本信息（姓名、头像等）

                // ── 群成员 ──
                "im:chat.members:read",             // 读取群成员列表（批量注册）
            ],
            user: []
        },
        events: [
            {
                name: "im.message.receive_v1",
                description: "接收消息 — 用户在群聊中发送文本/命令"
            },
            {
                name: "card.action.trigger",
                description: "卡片按钮回调 — 用户点击审批卡片的 Approve/Deny 按钮"
            },
            {
                name: "im.chat.member.bot.added_v1",
                description: "Bot 被拉入群聊 — 发送初始化卡片"
            },
            {
                name: "im.chat.member.user.added_v1",
                description: "新用户加入群聊 — 自动注册为项目成员"
            }
        ],
        apis: [
            { endpoint: "POST  /im/v1/messages", description: "发送消息 (text/interactive card)" },
            { endpoint: "PATCH /im/v1/messages/:id", description: "更新互动卡片" },
            { endpoint: "POST  /im/v1/pins", description: "Pin 消息" },
            { endpoint: "GET   /contact/v3/users/:id", description: "获取用户信息（显示名）" },
            { endpoint: "GET   /im/v1/chats/:chatId/members", description: "获取群成员列表（批量注册）" },
        ]
    };
}

const manifest = buildManifest();

// 标准权限格式
const output = {
    scopes: manifest.scopes,
};

// eslint-disable-next-line no-console
console.log(JSON.stringify(output, null, 2));

// eslint-disable-next-line no-console
console.log("\n--- 关键权限提醒 ---");
// eslint-disable-next-line no-console
console.log("  • cardkit:card:write  — 原生流式卡片 / CardKit 创建与更新必需");
// eslint-disable-next-line no-console
console.log("  • cardkit:card:read   — CardKit 卡片实体读取 / ID 转换");
// eslint-disable-next-line no-console
console.log("  • im:message:patch    — 传统互动卡片更新 / fallback 路径");

// eslint-disable-next-line no-console
console.log("\n--- 事件订阅（在「事件与回调」中配置）---");
for (const event of manifest.events) {
    // eslint-disable-next-line no-console
    console.log(`  • ${event.name}  — ${event.description}`);
}

// eslint-disable-next-line no-console
console.log("\n--- API 调用 ---");
for (const api of manifest.apis) {
    // eslint-disable-next-line no-console
    console.log(`  • ${api.endpoint}  — ${api.description}`);
}
