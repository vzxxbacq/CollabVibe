import { join } from "node:path";

import type { PlatformOutput, NotificationOutput } from "../../event/output-contracts";
import { createTestLayerHarness, createLocalSkillFixture, destroyTestLayerHarness, type TestLayerHarness } from "./test-layer";

import { FakeChatPlatform, type ChatActionInput, type ChatMessageInput } from "./fake-chat-platform";
import { FakeAgentApiFactory } from "./fake-agent-backend";
import type { BackendScriptStep } from "./scripted-backend";

interface PendingApprovalRecord {
  approvalId: string;
  projectId: string;
  chatId: string;
  threadName: string;
  turnId: string;
  callId: string;
}

interface PendingUserInputRecord {
  callId: string;
  projectId: string;
  chatId: string;
  threadName: string;
  turnId: string;
}

export class SimHarness {
  readonly platform = new FakeChatPlatform();
  readonly approvals: PendingApprovalRecord[] = [];
  readonly userInputs: PendingUserInputRecord[] = [];
  readonly outputsByProject = new Map<string, PlatformOutput[]>();
  readonly originalWorkspaceCwd = process.env.COLLABVIBE_WORKSPACE_CWD;
  readonly fakeBackend: FakeAgentApiFactory;

  private readonly projectChatMap = new Map<string, string>();

  private constructor(
    private readonly harness: TestLayerHarness,
    fakeBackend: FakeAgentApiFactory,
    readonly sysAdmins: string[],
  ) {
    this.fakeBackend = fakeBackend;
  }

  static async create(sysAdmins: string[] = ["admin-user"]): Promise<SimHarness> {
    const fakeBackend = new FakeAgentApiFactory();
    const harness = await createTestLayerHarness(sysAdmins, {
      transportFactories: { codex: fakeBackend },
    });

    const sim = new SimHarness(harness, fakeBackend, sysAdmins);

    // Re-register OutputGateway to capture outputs
    const gateway = {
      dispatch: async (projectId: string, output: PlatformOutput) => {
        const chatId = sim.projectChatMap.get(projectId) ?? projectId;
        const list = sim.outputsByProject.get(projectId) ?? [];
        list.push(output);
        sim.outputsByProject.set(projectId, list);
        sim.platform.recordOutput({ chatId, projectId, output });

        if (output.kind === "approval_request") {
          sim.approvals.push({
            approvalId: output.data.approvalId,
            projectId,
            chatId,
            threadName: output.data.threadName ?? "",
            turnId: output.data.turnId,
            callId: output.data.callId,
          });
        }
        if (output.kind === "user_input_request") {
          sim.userInputs.push({
            callId: output.data.callId,
            projectId,
            chatId,
            threadName: output.data.threadName ?? "",
            turnId: output.data.turnId,
          });
        }
      },
    };
    await harness.layer.runStartup(gateway);

    return sim;
  }

  async shutdown(): Promise<void> {
    await destroyTestLayerHarness(this.harness, this.originalWorkspaceCwd);
  }

  get api() {
    return this.harness.layer.api;
  }

  /** Mutable GitOps reference — override individual methods for test scenarios. */
  get gitOps() {
    return this.harness.gitOps;
  }

  bindProject(projectId: string, chatId: string): void {
    this.projectChatMap.set(projectId, chatId);
  }

  private notify(projectId: string, chatId: string, title: string): void {
    const output: NotificationOutput = {
      kind: "notification",
      data: { kind: "notification", threadId: "", category: "agent_message", title },
    };
    const list = this.outputsByProject.get(projectId) ?? [];
    list.push(output);
    this.outputsByProject.set(projectId, list);
    this.platform.recordOutput({ chatId, projectId, output });
  }

  recordChatMessage(input: ChatMessageInput): void {
    this.platform.recordMessage(input);
  }

  async createProjectFromChat(input: { chatId: string; userId: string; name: string }): Promise<string> {
    this.recordChatMessage({ chatId: input.chatId, userId: input.userId, text: `/project create ${input.name}` });
    const created = await this.api.createProject({ actorId: input.userId,
      chatId: input.chatId,
      userId: input.userId,
      name: input.name,
      cwd: join(this.harness.workspaceRoot, input.name),
      workBranch: `feature/${input.name}`,
    });
    if (!created.success || !created.project) {
      throw new Error(created.message || "createProject failed");
    }
    this.bindProject(created.project.id, input.chatId);
    this.notify(created.project.id, input.chatId, `project created: ${input.name}`);
    return created.project.id;
  }

  async addProjectMemberFromChat(input: { chatId: string; actorId: string; projectId: string; targetUserId: string; role: "maintainer" | "developer" | "auditor" }): Promise<void> {
    this.recordChatMessage({ chatId: input.chatId, userId: input.actorId, text: `/user add ${input.targetUserId} ${input.role}` });
    this.api.addProjectMember({ projectId: input.projectId, userId: input.targetUserId, role: input.role, actorId: input.actorId });
    this.notify(input.projectId, input.chatId, `member added: ${input.targetUserId}:${input.role}`);
  }

  async addAdminFromChat(input: { chatId: string; actorId: string; targetUserId: string }): Promise<void> {
    this.recordChatMessage({ chatId: input.chatId, userId: input.actorId, text: `/admin add ${input.targetUserId}` });
    this.api.addAdmin(input.targetUserId);
    const projectId = this.api.resolveProjectId(input.chatId) ?? input.chatId;
    this.notify(projectId, input.chatId, `admin added: ${input.targetUserId}`);
  }

  async installLocalSkillFromChat(input: { chatId: string; actorId: string; projectId: string; skillName: string }): Promise<void> {
    this.recordChatMessage({ chatId: input.chatId, userId: input.actorId, text: `/skill install ${input.skillName}` });
    const skillRoot = await createLocalSkillFixture(this.harness.root, input.skillName);
    await this.api.installFromLocalSource({ localPath: skillRoot, projectId: input.projectId, pluginName: input.skillName, actorId: input.actorId });
    this.notify(input.projectId, input.chatId, `skill installed: ${input.skillName}`);
  }

  async removeLocalSkillFromChat(input: { chatId: string; actorId: string; projectId: string; skillName: string }): Promise<void> {
    this.recordChatMessage({ chatId: input.chatId, userId: input.actorId, text: `/skill remove ${input.skillName}` });
    await this.api.removeSkill({ name: input.skillName, projectId: input.projectId, actorId: input.actorId });
    await this.api.removeSkill({ name: input.skillName, actorId: input.actorId });
    this.notify(input.projectId, input.chatId, `skill removed: ${input.skillName}`);
  }

  /**
   * Start a scripted turn via the real L2 API path:
   *   1. Register script on FakeAgentApiFactory
   *   2. api.createThread() → real ThreadUseCaseService → FakeAgentApiFactory.create() → FakeAgentApi
   *   3. api.createTurn()  → real TurnLifecycleService → EventPipeline → FakeAgentApi.turnStart() → script playback
   *
   * NOTE: threadId and turnId are auto-generated by FakeAgentApi.
   *       The returned values should be used for subsequent assertions.
   */
  async startScriptedTurn(input: {
    projectId: string;
    chatId: string;
    userId: string;
    threadName: string;
    threadId: string;     // ignored (auto-generated)
    turnId: string;       // ignored (auto-generated)
    script: BackendScriptStep[];
  }): Promise<void> {
    this.bindProject(input.projectId, input.chatId);

    // 1. Register script
    this.fakeBackend.setScript(input.threadName, input.script);

    // 2. Ensure user is a project member — use the layer's sysAdmin as actorId
    try {
      this.api.addProjectMember({ projectId: input.projectId, userId: input.userId, role: "developer", actorId: this.sysAdmins[0] });
    } catch { /* already a member */ }

    // 3. Create thread via real L2 path
    await this.api.createThread({
      projectId: input.projectId,
      userId: input.userId,
      actorId: this.sysAdmins[0],
      threadName: input.threadName,
      backendId: "codex",
      model: "fake-model",
    });

    // 4. Create turn via real L2 path — this triggers:
    //    TurnLifecycleService → prepareTurnPipeline → EventPipeline.attachSource(fakeAgentApi)
    //    → fakeAgentApi.onNotification(handler) → ScriptedBackendSource wired
    //    → fakeAgentApi.turnStart() → source.start() → script playback → handler(event)
    await this.api.createTurn({
      projectId: input.projectId,
      userId: input.userId,
      actorId: this.sysAdmins[0],
      text: "scripted turn",
    });

    // 5. Wait for script to drain
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async approve(input: ChatActionInput & { payload: { approvalId: string } }): Promise<void> {
    this.platform.recordAction(input);
    const approval = this.approvals.find((item) => item.approvalId === input.payload.approvalId);
    if (!approval) throw new Error(`approval not found: ${input.payload.approvalId}`);

    // Drive approval through real L2 API
    await this.api.handleApprovalCallback({
      approvalId: input.payload.approvalId,
      decision: "accept",
    });

    // Wait for post-approval script to drain
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async replyUserInput(input: ChatActionInput & { payload: { callId: string; answers: Record<string, string[]> } }): Promise<void> {
    this.platform.recordAction(input);
    const request = this.userInputs.find((item) => item.callId === input.payload.callId);
    if (!request) throw new Error(`user input not found: ${input.payload.callId}`);

    // Get the FakeAgentApi for this thread and resolve user input
    const fakeApi = this.fakeBackend.getApi(request.threadName);
    if (!fakeApi) throw new Error(`fake api not found for thread: ${request.threadName}`);
    await fakeApi.respondUserInput({ callId: input.payload.callId, answers: input.payload.answers });

    // Wait for post-reply script to drain
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
