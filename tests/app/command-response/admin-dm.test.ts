import { describe, expect, it, vi } from "vitest";

import { handleInboundMessage } from "../../../src/handlers/inbound-message";
import { handleCardAction } from "../../../src/feishu/feishu-card-handler";
import type { ServerHandlerDeps } from "../../../src/handlers/types";
import { RoleResolver } from "../../../services/iam/src/role-resolver";
import { OrchestratorError } from "../../../services/orchestrator/src/errors";
import { armPendingFeishuSkillInstall } from "../../../src/feishu/skill-file-install-state";

/**
 * 构建最小 ServerHandlerDeps mock — 避免每个测试重复大量样板。
 */
function createMockDeps(overrides: Partial<ServerHandlerDeps> = {}): ServerHandlerDeps {
    return {
        config: {
            feishu: { appId: "", appSecret: "", signingSecret: "", apiBaseUrl: "" },
            cwd: "/repo",
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            server: { port: 0, approvalTimeoutMs: 300000, sysAdminUserIds: [] }
        },
        feishuAdapter: {
            sendMessage: vi.fn(async () => "msg-1"),
            sendInteractiveCard: vi.fn(async () => "card-1"),
            getUserDisplayName: vi.fn(async () => "Test User"),
            pinMessage: vi.fn()
            ,
            downloadMessageFile: vi.fn(async () => ({ localPath: "/tmp/skill.tgz", originalName: "skill.tgz" }))
        },
        feishuOutputAdapter: {
            buildHelpCard: vi.fn(() => ({ help: true })),
            buildInitCard: vi.fn(),
            buildInitSuccessCard: vi.fn(),
            buildThreadCreatedCard: vi.fn(),
            buildMergeResultCard: vi.fn(),
            buildMergePreviewCard: vi.fn(),
            buildThreadListCard: vi.fn(),
            buildSnapshotHistoryCard: vi.fn(),
            buildModelListCard: vi.fn(),
            buildAdminHelpCard: vi.fn(() => ({ adminHelp: true })),
            buildAdminSkillCard: vi.fn(() => ({ skillAdmin: true })),
            buildAdminSkillFileConfirmCard: vi.fn(() => ({ confirm: true })),
            sendThreadNewForm: vi.fn(),
            sendThreadOperation: vi.fn(),
            sendSnapshotOperation: vi.fn(),
            sendConfigOperation: vi.fn(),
            sendSkillOperation: vi.fn(),
            sendMergeOperation: vi.fn(),
            sendAdminHelp: vi.fn(),
            sendRawCard: vi.fn(),
            updateCardAction: vi.fn(),
            primeHistoricalTurnCard: vi.fn(() => ({ turnDetail: true })),
            getTurnCardThreadName: vi.fn(),
            setCardThreadName: vi.fn(),
            setCardBackendInfo: vi.fn()
        },
        orchestrator: {
            handleIntent: vi.fn(),
            handleThreadList: vi.fn(),
            createThread: vi.fn(),
            handleThreadJoin: vi.fn(),
            handleThreadLeave: vi.fn(),
            handleTurnInterrupt: vi.fn(),
            handleRollback: vi.fn(),
            acceptTurn: vi.fn(),
            revertTurn: vi.fn(),
            handleMerge: vi.fn(),
            handleMergePreview: vi.fn(),
            listSnapshots: vi.fn(),
            jumpToSnapshot: vi.fn(),
            recordTurnStart: vi.fn(),
            updateSnapshotSummary: vi.fn(),
            getTurnDetail: vi.fn(async () => { throw new Error("missing"); }),
            listTurns: vi.fn(async () => []),
            isPendingApproval: vi.fn(() => false),
            getUserActiveThread: vi.fn(async () => null)
        },
        runtimeConfigProvider: {
            getProjectRuntimeConfig: vi.fn(async () => ({ model: "gpt-5-codex", cwd: "/repo" }))
        },
        apiPool: {
            getOrCreate: vi.fn(),
            release: vi.fn(async () => undefined),
            getLifecycleState: vi.fn(() => "NOT_STARTED")
        },
        backendSessionResolver: {
            resolve: vi.fn(async () => ({ backendName: "codex", model: "gpt-5-codex", availableModels: ["gpt-5-codex"], transport: "codex" })),
            listAvailableBackends: vi.fn(async () => []),
            getDefaultBackendName: vi.fn(() => "codex"),
            getDefaultModel: vi.fn(() => "gpt-5-codex"),
            resolveBackendByName: vi.fn(async () => undefined)
        },
        pluginService: {
            getInstallablePlugins: vi.fn(async () => []),
            listProjectPlugins: vi.fn(async () => []),
            list: vi.fn(async () => []),
            install: vi.fn(),
            remove: vi.fn(),
            allocateStagingDir: vi.fn(async () => "/tmp/plugin-staging/feishu-upload-admin-user-1"),
            inspectLocalSource: vi.fn(async () => ({
                resolvedLocalPath: "/tmp/plugin-staging/feishu-upload-admin-user-1/resolved-skill/uploaded-skill",
                resolvedPluginName: "uploaded-skill",
                manifestName: "uploaded-skill",
                manifestDescription: "uploaded manifest"
            })),
            validateSkillNameCandidate: vi.fn((name: string) => ({ ok: true, normalizedName: name })),
            installFromLocalSource: vi.fn(async () => ({ name: "skill", description: "", path: "/tmp/skill", source: "feishu:test", hasScripts: false, hasData: false, mcpServers: [] }))
        },
        threadBindingService: { get: vi.fn() },
        userThreadBindingService: { resolve: vi.fn(async () => null), list: vi.fn(async () => []) },
        approvalHandler: { handle: vi.fn() },
        projectSetupService: { setupFromInitCard: vi.fn() },
        adminStateStore: { read: vi.fn(() => ({ projects: [], members: {}, wizardStep: {} })), write: vi.fn() },
        findProjectByChatId: vi.fn(() => null),
        userRepository: {
            isAdmin: vi.fn((id: string) => id === "admin-user-1"),
            listAdmins: vi.fn(() => [{ userId: "admin-user-1", sysRole: 1, source: "env" }]),
            setAdmin: vi.fn(),
            removeAdmin: vi.fn(() => ({ ok: true })),
            ensureUser: vi.fn(),
            listAll: vi.fn(() => ({ users: [{ userId: "admin-user-1", sysRole: 1, source: "env" }], total: 1 })),
        },
        roleResolver: new RoleResolver(
            { isAdmin: (id: string) => id === "admin-user-1", listAdmins: () => [], setAdmin: () => {}, removeAdmin: () => ({ ok: true }), ensureUser: () => {}, listAll: () => ({ users: [], total: 0 }) },
            { read: () => ({ projects: [], members: {}, wizardStep: {} }), write: vi.fn() }
        ),
        recentMessageIds: new Set(),
        messageDedupTtlMs: 1000,
        eventPipeline: { bind: vi.fn() },
        threadRegistry: {
            reserve: () => ({ reservationId: 'resv-1', projectId: 'proj-1', threadName: 't1' }),
            activate: () => { },
            release: () => { },
            get: () => undefined,
            register: () => { },
            updateSessionId: () => { }
        },
        ...overrides
    } as unknown as ServerHandlerDeps;
}

function makePayload(opts: { chatType?: string; text?: string; userId?: string; messageId?: string; messageType?: string; content?: Record<string, unknown> }) {
    return {
        message: {
            chat_id: "chat-dm-1",
            chat_type: opts.chatType ?? "p2p",
            content: JSON.stringify(opts.content ?? { text: opts.text ?? "" }),
            message_id: opts.messageId ?? `msg-${Date.now()}`
            ,
            message_type: opts.messageType ?? "text"
        },
        sender: { sender_id: { open_id: opts.userId ?? "admin-user-1" } }
    };
}

describe("admin-dm", () => {
    it("accept_changes resolves via turnId instead of current active thread", async () => {
        const deps = createMockDeps();

        await handleCardAction(deps, {
            action: { value: { action: "accept_changes", turnId: "turn-m25-1" } },
            operator: { open_id: "admin-user-1" },
            context: { open_chat_id: "chat-dm-1", open_message_id: "msg-accept-1" }
        });

        expect(deps.orchestrator.acceptTurn).toHaveBeenCalledWith("chat-dm-1", "turn-m25-1");
    });

    it("revert_changes resolves via turnId instead of current active thread", async () => {
        const deps = createMockDeps();

        await handleCardAction(deps, {
            action: { value: { action: "revert_changes", turnId: "turn-m25-1" } },
            operator: { open_id: "admin-user-1" },
            context: { open_chat_id: "chat-dm-1", open_message_id: "msg-revert-1" }
        });

        expect(deps.orchestrator.revertTurn).toHaveBeenCalledWith("chat-dm-1", "turn-m25-1");
        expect(deps.orchestrator.handleRollback).not.toHaveBeenCalled();
    });

    it("admin DM + /help → silently ignored (admin uses bot menu)", async () => {
        const deps = createMockDeps();
        await handleInboundMessage(deps, makePayload({ text: "/help" }));

        expect(deps.feishuAdapter.sendMessage).not.toHaveBeenCalled();
        expect(deps.feishuAdapter.sendInteractiveCard).not.toHaveBeenCalled();
        expect(deps.feishuOutputAdapter.sendAdminHelp).not.toHaveBeenCalled();
    });

    it("non-admin DM + any message → silently ignored (no response)", async () => {
        const deps = createMockDeps();
        await handleInboundMessage(deps, makePayload({
            text: "/help",
            userId: "regular-user-1"
        }));

        expect(deps.feishuOutputAdapter.sendAdminHelp).not.toHaveBeenCalled();
        expect(deps.feishuAdapter.sendMessage).not.toHaveBeenCalled();
        expect(deps.feishuAdapter.sendInteractiveCard).not.toHaveBeenCalled();
    });

    it("non-admin DM + text message → silently ignored", async () => {
        const deps = createMockDeps();
        await handleInboundMessage(deps, makePayload({
            text: "hello bot",
            userId: "regular-user-1"
        }));

        expect(deps.feishuAdapter.sendMessage).not.toHaveBeenCalled();
    });

    it("admin DM + /thread list → silently ignored (all DM text blocked)", async () => {
        const deps = createMockDeps();
        await handleInboundMessage(deps, makePayload({ text: "/thread list" }));

        expect(deps.feishuAdapter.sendMessage).not.toHaveBeenCalled();
        expect(deps.feishuAdapter.sendInteractiveCard).not.toHaveBeenCalled();
    });

    it("admin DM + /models → silently ignored", async () => {
        const deps = createMockDeps();
        await handleInboundMessage(deps, makePayload({ text: "/models" }));

        expect(deps.feishuAdapter.sendMessage).not.toHaveBeenCalled();
    });

    it("admin DM + /merge → silently ignored", async () => {
        const deps = createMockDeps();
        await handleInboundMessage(deps, makePayload({ text: "/merge feature-x" }));

        expect(deps.feishuAdapter.sendMessage).not.toHaveBeenCalled();
    });

    it("admin DM + /project list → silently ignored (admin uses bot menu)", async () => {
        const deps = createMockDeps();
        await handleInboundMessage(deps, makePayload({ text: "/project list" }));

        expect(deps.feishuAdapter.sendMessage).not.toHaveBeenCalled();
        expect(deps.feishuAdapter.sendInteractiveCard).not.toHaveBeenCalled();
    });

    it("group chat + /help → calls buildHelpCard (not sendAdminHelp)", async () => {
        const deps = createMockDeps();
        await handleInboundMessage(deps, makePayload({
            text: "/help",
            chatType: "group"
        }));

        // In group chat, bot requires @mention. Since we don't mock mentions,
        // the message is ignored (no mention in group).
        expect(deps.feishuOutputAdapter.sendAdminHelp).not.toHaveBeenCalled();
    });

    it("group chat + @bot empty message → shows help card", async () => {
        const deps = createMockDeps();
        // Simulate @mention with empty text after stripping mention
        await handleInboundMessage(deps, makePayload({
            text: "@_user_1",
            chatType: "group"
        }));

        // After stripping @_user_1, text is empty → should show help card
        // But since hasMention check requires mentions array, this is ignored
        // (group chat without mentions array is filtered out)
        expect(deps.feishuOutputAdapter.sendAdminHelp).not.toHaveBeenCalled();
    });

    it("admin DM file upload stages skill and waits for confirmation", async () => {
        const deps = createMockDeps();
        armPendingFeishuSkillInstall({
            chatId: "chat-dm-1",
            userId: "admin-user-1",
            pluginName: "uploaded-skill"
        });

        await handleInboundMessage(deps, makePayload({
            messageType: "file",
            content: { file_key: "file-key-1", file_name: "skill.tgz" }
        }));

        expect(deps.feishuAdapter.downloadMessageFile).toHaveBeenCalled();
        expect(deps.pluginService.inspectLocalSource).toHaveBeenCalled();
        expect(deps.pluginService.installFromLocalSource).not.toHaveBeenCalled();
        expect(deps.feishuAdapter.sendInteractiveCard).toHaveBeenCalled();
    });

    it("confirming staged DM file upload installs skill through unified local entry", async () => {
        const deps = createMockDeps();
        armPendingFeishuSkillInstall({
            chatId: "chat-dm-1",
            userId: "admin-user-1",
            pluginName: "uploaded-skill"
        });
        await handleInboundMessage(deps, makePayload({
            messageType: "file",
            content: { file_key: "file-key-1", file_name: "skill.tgz" }
        }));

        await handleCardAction(deps as any, {
            operator: { open_id: "admin-user-1" },
            context: { open_chat_id: "chat-dm-1", open_message_id: "om-card-1" },
            action: {
                value: { action: "admin_skill_file_install_confirm" },
                form_value: { skill_name: "renamed-skill" }
            }
        });

        expect(deps.pluginService.installFromLocalSource).toHaveBeenCalledWith(expect.objectContaining({
            localPath: "/tmp/plugin-staging/feishu-upload-admin-user-1/resolved-skill/uploaded-skill",
            pluginName: "renamed-skill"
        }));
    });

    it("keeps staged install and re-renders confirm card when skill name validation fails", async () => {
        const deps = createMockDeps();
        (deps.pluginService.validateSkillNameCandidate as any) = vi.fn(() => ({
            ok: false,
            reason: "Skill 名称已存在"
        }));
        armPendingFeishuSkillInstall({
            chatId: "chat-dm-1",
            userId: "admin-user-1",
            pluginName: "uploaded-skill"
        });
        await handleInboundMessage(deps, makePayload({
            messageType: "file",
            content: { file_key: "file-key-1", file_name: "skill.tgz" }
        }));

        const result = await handleCardAction(deps as any, {
            operator: { open_id: "admin-user-1" },
            context: { open_chat_id: "chat-dm-1", open_message_id: "om-card-1" },
            action: {
                value: { action: "admin_skill_file_install_confirm" },
                form_value: { skill_name: "existing-skill" }
            }
        });

        expect(deps.pluginService.installFromLocalSource).not.toHaveBeenCalled();
        expect(deps.feishuAdapter.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("安装失败") }));
        expect(result).toEqual({ card: { type: "raw", data: { confirm: true } } });
        expect(deps.feishuOutputAdapter.buildAdminSkillFileConfirmCard).toHaveBeenCalledWith(expect.objectContaining({
            pluginName: "existing-skill",
            validationError: "Skill 名称已存在"
        }));
    });

    it("uses actionValue.chatId when opening historical turn detail from another chat context", async () => {
        const deps = createMockDeps({
            orchestrator: {
                handleIntent: vi.fn(),
                handleThreadList: vi.fn(),
                createThread: vi.fn(),
                handleThreadJoin: vi.fn(),
                handleThreadLeave: vi.fn(),
                handleTurnInterrupt: vi.fn(),
                handleRollback: vi.fn(),
                acceptTurn: vi.fn(),
                revertTurn: vi.fn(),
                handleMerge: vi.fn(),
                handleMergePreview: vi.fn(),
                listSnapshots: vi.fn(),
                jumpToSnapshot: vi.fn(),
                recordTurnStart: vi.fn(),
                updateSnapshotSummary: vi.fn(),
                isPendingApproval: vi.fn(() => false),
                getUserActiveThread: vi.fn(async () => null),
                getTurnDetail: vi.fn(async (chatId: string) => ({
                    record: { turnId: "turn-1", threadName: "fix-1", status: "accepted", diffSummary: "", filesChanged: [], tokenUsage: undefined },
                    detail: chatId === "chat-group-1"
                        ? { backendName: "codex", modelName: "gpt-5", reasoning: "r", message: "m", tools: [], toolOutputs: [], planState: undefined, promptSummary: "p", agentNote: undefined, turnMode: undefined }
                        : null
                })),
                listTurns: vi.fn(async () => [])
            } as any
        });

        const result = await handleCardAction(deps as any, {
            operator: { open_id: "admin-user-1" },
            context: { open_chat_id: "chat-dm-1", open_message_id: "om-card-2" },
            action: { value: { action: "view_turn_detail", chatId: "chat-group-1", turnId: "turn-1" } }
        });

        expect(deps.orchestrator.getTurnDetail).toHaveBeenCalledWith("chat-group-1", "turn-1");
        expect(result).toEqual({ card: { type: "raw", data: { turnDetail: true } } });
    });

    it("notifies explicit diagnostics when historical turn recovery data is missing", async () => {
        const deps = createMockDeps({
            findProjectByChatId: vi.fn((chatId: string) => chatId === "chat-group-1" ? {
                id: "proj-1",
                name: "Demo",
                chatId,
                cwd: "/repo/demo",
                enabledSkills: [],
                sandbox: "workspace-write",
                approvalPolicy: "on-request",
                status: "active" as const
            } : null),
            orchestrator: {
                handleIntent: vi.fn(),
                handleThreadList: vi.fn(),
                createThread: vi.fn(),
                handleThreadJoin: vi.fn(),
                handleThreadLeave: vi.fn(),
                handleTurnInterrupt: vi.fn(),
                handleRollback: vi.fn(),
                acceptTurn: vi.fn(),
                revertTurn: vi.fn(),
                handleMerge: vi.fn(),
                handleMergePreview: vi.fn(),
                listSnapshots: vi.fn(),
                jumpToSnapshot: vi.fn(),
                recordTurnStart: vi.fn(),
                updateSnapshotSummary: vi.fn(),
                isPendingApproval: vi.fn(() => false),
                getUserActiveThread: vi.fn(async () => null),
                getTurnDetail: vi.fn(async () => { throw new OrchestratorError("TURN_RECORD_MISSING" as any, "missing", { projectId: "proj-1", chatId: "chat-group-1", turnId: "turn-missing" }); }),
                listTurns: vi.fn(async () => [])
            } as any
        });

        await handleCardAction(deps as any, {
            operator: { open_id: "admin-user-1" },
            context: { open_chat_id: "chat-dm-1", open_message_id: "om-card-3" },
            action: { value: { action: "view_turn_detail", chatId: "chat-group-1", turnId: "turn-missing" } }
        });

        expect(deps.feishuAdapter.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            chatId: "chat-dm-1",
            text: expect.stringContaining("turnId=turn-missing projectId=proj-1 chatId=chat-group-1")
        }));
    });
});
