import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SqlitePluginCatalogStore,
} from "../../../persistence/src/index";
import type { AdminPersistedState } from "../../../admin-api/src/contracts";
import { PluginService } from "../../src/index";

describe("PluginService", () => {
  let db: DatabaseSync;
  let rootDir: string;
  let sourceDir: string;
  let service: PluginService;
  let githubRepoDir: string;
  let adminState: AdminPersistedState;
  let adminStateStore: { read(): AdminPersistedState; write(state: AdminPersistedState): void };

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    rootDir = mkdtempSync(join(tmpdir(), "plugin-service-"));
    sourceDir = join(rootDir, "sample-skill");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), `---
name: sample-skill
description: demo plugin
mcp_servers:
  - name: browser
    command: npx
    args: ["@example/browser"]
---
# demo
`);
    githubRepoDir = join(rootDir, "repo");
    mkdirSync(join(githubRepoDir, ".claude", "skills", "ui-ux-pro-max"), { recursive: true });
    writeFileSync(join(githubRepoDir, ".claude", "skills", "ui-ux-pro-max", "SKILL.md"), `---
name: ui-ux-pro-max
description: nested skill
---
# nested
`);
    adminState = {
      wizardStep: {},
      projects: [{
        id: "proj-1",
        name: "Demo",
        chatId: "chat-1",
        cwd: join(rootDir, "project-1"),
        enabledSkills: [],
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        status: "active",
      }],
      members: {}
    };
    adminStateStore = {
      read: () => JSON.parse(JSON.stringify(adminState)),
      write: (state) => { adminState = JSON.parse(JSON.stringify(state)); }
    };
    mkdirSync(join(rootDir, "project-1"), { recursive: true });
    service = new PluginService(
      rootDir,
      new SqlitePluginCatalogStore(db),
      {
        gitClone: async (_source, targetDir) => {
          await rm(targetDir, { recursive: true, force: true });
          mkdirSync(targetDir, { recursive: true });
          await import("node:fs/promises").then(fs => fs.cp(githubRepoDir, targetDir, { recursive: true }));
        }
      },
      adminStateStore
    );
  });

  afterEach(async () => {
    db.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("installs a local skill into catalog and records metadata", async () => {
    const plugin = await service.installFromLocalSource({
      localPath: sourceDir,
      sourceLabel: "feishu:file-key:test-local",
      pluginName: "demo-local",
      actorId: "admin-1",
    });

    expect(plugin.name).toBe("sample-skill");
    expect(service.listCatalog()).toEqual([
      expect.objectContaining({
        pluginName: "demo-local",
        sourceType: "feishu-upload",
        downloadStatus: "downloaded",
        downloadedBy: "admin-1",
      })
    ]);
  });

  it("derives skillName from manifest when local install omits pluginName", async () => {
    const plugin = await service.installFromLocalSource({
      localPath: sourceDir,
      sourceLabel: "feishu:file-key:test-manifest",
      actorId: "admin-1",
    });

    expect(plugin.name).toBe("sample-skill");
    expect(service.listCatalog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginName: "sample-skill",
          sourceType: "feishu-upload",
        })
      ])
    );
  });

  it("validates skillName candidate format and conflict", async () => {
    expect(service.validateSkillNameCandidate("bad name")).toEqual(
      expect.objectContaining({ ok: false })
    );

    await service.installFromLocalSource({
      localPath: sourceDir,
      sourceLabel: "feishu:file-key:test-conflict",
      pluginName: "existing-skill",
      actorId: "admin-1",
    });

    expect(service.validateSkillNameCandidate("existing-skill")).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringContaining("已存在") })
    );
    expect(service.validateSkillNameCandidate("next-skill")).toEqual({
      ok: true,
      normalizedName: "next-skill",
    });
  });

  it("binds downloaded plugins to a project and scopes MCP collection", async () => {
    await service.installFromLocalSource({
      localPath: sourceDir,
      sourceLabel: "feishu:file-key:test-bind",
      pluginName: "demo-local",
      actorId: "admin-1",
    });
    await service.bindToProject("proj-1", "demo-local", "admin-1");

    const plugins = await service.listProjectPlugins("proj-1");
    expect(plugins).toEqual([
      expect.objectContaining({
        pluginName: "demo-local",
        downloaded: true,
        enabled: true,
      })
    ]);

    const mcpServers = await service.collectMcpServers("proj-1");
    expect(mcpServers).toEqual([
      expect.objectContaining({ name: "browser", command: "npx" })
    ]);

    await service.unbindFromProject("proj-1", "demo-local");
    expect(await service.collectMcpServers("proj-1")).toEqual([]);
  });

  it("imports a GitHub repo skill from an explicit subpath", async () => {
    const plugin = await service.importFromGithubSubpath({
      repoUrl: "https://github.com/example/skills.git",
      skillSubpath: ".claude/skills/ui-ux-pro-max",
      pluginName: "ui-ux-pro-max",
      actorId: "admin-1",
    });

    expect(plugin.name).toBe("ui-ux-pro-max");
    expect(service.listCatalog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginName: "ui-ux-pro-max",
          sourceType: "github-subpath",
          skillSubpath: ".claude/skills/ui-ux-pro-max",
        })
      ])
    );
  });

  it("rejects illegal GitHub skill subpaths", async () => {
    await expect(service.importFromGithubSubpath({
      repoUrl: "https://github.com/example/skills.git",
      skillSubpath: "/../../etc",
      pluginName: "bad-skill",
      actorId: "admin-1",
    })).rejects.toThrow("Skill 子路径非法");
  });

  it("installs a local directory source through the unified local entry", async () => {
    const plugin = await service.installFromLocalSource({
      localPath: sourceDir,
      sourceLabel: "feishu:file-key:test-1",
      pluginName: "local-source-skill",
      actorId: "admin-1",
    });

    expect(plugin.name).toBe("sample-skill");
    expect(service.listCatalog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginName: "local-source-skill",
          sourceType: "feishu-upload",
        })
      ])
    );
  });

  it("installs a local archive source through the unified local entry", async () => {
    const archiveSkill = join(rootDir, "archive-skill");
    mkdirSync(archiveSkill, { recursive: true });
    writeFileSync(join(archiveSkill, "SKILL.md"), `---
name: zip-skill
description: imported from zip
---
# zip
`);
    const archivePath = join(rootDir, "zip-skill.tgz");
    writeFileSync(archivePath, "fake tgz");
    const archiveService = new PluginService(
      rootDir,
      new SqlitePluginCatalogStore(db),
      { localArchiveResolve: async () => archiveSkill },
      adminStateStore
    );

    const plugin = await archiveService.installFromLocalSource({
      localPath: archivePath,
      sourceLabel: "feishu:file-key:test-zip",
      pluginName: "zip-skill",
      actorId: "admin-1",
    });

    expect(plugin.name).toBe("zip-skill");
    expect(archiveService.listCatalog()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginName: "zip-skill",
          sourceType: "feishu-upload",
        })
      ])
    );
  });

  it("rejects archives that contain multiple skill roots", async () => {
    const archivePath = join(rootDir, "multi.tgz");
    writeFileSync(archivePath, "fake tgz");
    const archiveService = new PluginService(
      rootDir,
      new SqlitePluginCatalogStore(db),
      { localArchiveResolve: async () => { throw new Error("压缩包中找到多个 Skill 目录，请只提供单个 Skill"); } },
      adminStateStore
    );

    await expect(archiveService.installFromLocalSource({
      localPath: archivePath,
      sourceLabel: "feishu:file-key:test-multi",
      pluginName: "multi-skill",
      actorId: "admin-1",
    })).rejects.toThrow("多个 Skill");
  });

});
