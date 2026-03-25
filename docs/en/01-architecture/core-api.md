---
title: "L2 Orchestrator Core API"
layer: architecture
source_of_truth: services/orchestrator-api.ts, services/index.ts, services/api-guard.ts
status: active
---

# L2 Orchestrator Core API

This page documents the **current** L2 public surface.

The single source of truth is code:

- `services/orchestrator-api.ts` defines the public types and method signatures
- `services/index.ts` is the only supported import entry for L0/L1
- `services/api-guard.ts` applies auth and audit as an internal proxy layer

## Public entry

```ts
interface OrchestratorLayer {
  api: OrchestratorApi;
  runStartup(gateway: OutputGateway): Promise<void>;
  shutdown(): Promise<void>;
}
```

`src/server.ts` calls `createOrchestratorLayer(...)`, then passes `layer.api` into platform modules.

## Import boundary

L1 should import from `services/index.ts` only.

- Allowed: `createOrchestratorLayer`, `OrchestratorApi`, shared public types
- Not allowed: direct imports from `services/thread/*`, `services/turn/*`, `services/persistence/*`, or other internal modules

## Guard layer

`withApiGuards(...)` wraps the raw API in L2. L1 does not call auth or audit code directly.

Current permission families:

- `project.read`
- `config.write`
- `thread.manage`
- `turn.operate`
- `thread.merge`
- `skill.manage`
- `system.admin`

Audit is attached to mutating operations such as project creation, thread creation, turn actions, merge execution, backend admin changes, and approval callbacks.

## API groups

`OrchestratorApi` currently exposes **88 methods**:

- §0-§9 grouped domain methods
- `enqueueAsyncPlatformMutation` as an async platform-output helper

### §0 Project and binding

13 methods:

- `resolveProjectId`
- `getProjectRecord`
- `createProject`
- `linkProjectToChat`
- `unlinkProject`
- `disableProject`
- `reactivateProject`
- `deleteProject`
- `listProjects`
- `listUnboundProjects`
- `updateGitRemote`
- `updateProjectConfig`
- `toggleProjectStatus`

Primary implementation files:

- `services/project/project-service.ts`
- `services/project/project-setup-service.ts`

### §1 Thread management

8 methods:

- `createThread`
- `joinThread`
- `leaveThread`
- `listThreads`
- `deleteThread`
- `getUserActiveThread`
- `getThreadRecord`
- `isPendingApproval`

Primary implementation files:

- `services/thread/create-thread-layer.ts`
- `services/thread/thread-service.ts`
- `services/thread/thread-runtime-service.ts`
- `services/thread/thread-use-case-service.ts`

### §2 Turn lifecycle

5 methods:

- `createTurn`
- `interruptTurn`
- `acceptTurn`
- `revertTurn`
- `respondUserInput`

Primary implementation files:

- `services/turn/turn-lifecycle-service.ts`
- `services/turn/turn-command-service.ts`

### §3 Turn data

3 methods:

- `getTurnDetail`
- `getTurnCardData`
- `listTurns`

Primary implementation file:

- `services/turn/turn-query-service.ts`

### §4 Snapshot

3 methods:

- `listSnapshots`
- `jumpToSnapshot`
- `getSnapshotDiff`

Primary implementation files:

- `services/snapshot/create-snapshot-layer.ts`
- `services/snapshot/snapshot-service.ts`

### §5 Merge

16 methods:

- `handleMerge`
- `handleMergePreview`
- `handleMergeConfirm`
- `handleMergeReject`
- `startMergeReview`
- `getMergeReview`
- `mergeDecideFile`
- `mergeAcceptAll`
- `commitMergeReview`
- `cancelMergeReview`
- `configureMergeResolver`
- `resolveConflictsViaAgent`
- `retryMergeFile`
- `retryMergeFiles`
- `pushWorkBranch`
- `detectStaleThreads`

Primary implementation files:

- `services/merge/merge-service.ts`
- `services/thread/thread-runtime-service.ts`
- `services/project/project-service.ts`

### §6 Backend administration

16 methods:

- `listAvailableBackends`
- `listModelsForBackend`
- `getBackendCatalog`
- `resolveBackend`
- `resolveSession`
- `readBackendConfigs`
- `adminAddProvider`
- `adminRemoveProvider`
- `adminAddModel`
- `adminRemoveModel`
- `adminTriggerRecheck`
- `readBackendPolicy`
- `updateBackendPolicy`
- `adminWriteProfile`
- `adminDeleteProfile`
- `checkBackendHealth`

Primary implementation files:

- `services/backend/backend-service.ts`
- `services/backend/config-service.ts`
- `services/backend/session-resolver.ts`

### §7 IAM and users

12 methods:

- `resolveRole`
- `isAdmin`
- `addAdmin`
- `removeAdmin`
- `listAdmins`
- `addProjectMember`
- `removeProjectMember`
- `updateProjectMemberRole`
- `listProjectMembers`
- `listUsers`

Primary implementation files:

- `services/iam/iam-service.ts`
- `services/iam/role-resolver.ts`

### §8 Skills

10 methods:

- `listSkills`
- `listProjectSkills`
- `installSkill`
- `removeSkill`
- `bindSkillToProject`
- `unbindSkillFromProject`
- `installFromGithub`
- `installFromLocalSource`
- `inspectLocalSource`
- `allocateStagingDir`
- `validateSkillNameCandidate`
- `listSkillCatalog`

Primary implementation file:

- `services/plugin/plugin-service.ts`

### §9 Approval callback

1 method:

- `handleApprovalCallback`

Primary implementation files:

- `services/approval/approval-callback-handler.ts`
- `services/approval/approval-use-case.ts`

## Async platform mutation helper

1 method:

- `enqueueAsyncPlatformMutation`

Primary implementation files:

- `services/factory.ts`
- `services/event/output-intent-buffer.ts`

## Shared public types

The main public types exported from `services/index.ts` include:

- `ProjectRecord`
- `ThreadRecord`
- `TurnRecord`
- `TurnDetailRecord`
- `TurnSnapshotRecord`
- `TurnCardData`
- `BackendIdentity`
- `BackendId`
- `MergeContext`
- `MergeResult`
- `PlatformOutput`
- `OutputGateway`

## Output contract

Path B and async orchestration output are delivered through `OutputGateway` and the `services/event/output-contracts.ts` platform output model.

This keeps platform rendering in L1 while allowing L2 to emit:

- content deltas
- reasoning deltas
- plan updates
- tool progress
- approval requests
- user input requests
- turn summaries
- merge events
- async platform mutations

## Notes

- This page summarizes the API surface, but does not duplicate full TypeScript signatures.
- If this page and code disagree, `services/orchestrator-api.ts` wins.
