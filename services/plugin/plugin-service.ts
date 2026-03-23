import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, cp, rm, mkdir, stat, symlink, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve as pathResolve, basename, relative, dirname } from "node:path";
import JSZip from "jszip";
import * as tar from "tar";

import type {
    PluginCatalogEntry,
    PluginCatalogStore,
    PluginSourceType,
} from "../persistence/contracts";
import type { AdminStateStore, ProjectRecord } from "../project/app-config";
import { createLogger } from "../../packages/logger/src/index";
import type { GitOps } from "../../packages/git-utils/src/index";
import {
    ALL_BACKEND_SKILL_DIRS,
    buildPluginStagingDirName,
    resolvePluginCanonicalStore,
    resolvePluginStagingRoot,
    type PluginStagingScope,
} from "./plugin-paths";
import { parsePluginFrontmatter, type McpServerDecl } from "./plugin-manifest";
import { derivePluginName, normalizePluginName } from "./plugin-name-policy";
import { isArchivePath, normalizeSubpath } from "./plugin-path-policy";

export interface PluginDefinition {
    name: string;
    description: string;
    path: string;
    source: string;
    hasScripts: boolean;
    hasData: boolean;
    mcpServers: McpServerDecl[];
}

export interface ProjectPluginDefinition extends PluginDefinition {
    pluginName: string;
    sourceType: PluginSourceType;
    skillSubpath?: string;
    downloaded: boolean;
    enabled: boolean;
    downloadedBy?: string;
    downloadedAt?: string;
}

export interface GithubSubpathImportRequest {
    repoUrl: string;
    skillSubpath: string;
    pluginName?: string;
    actorId: string;
    description?: string;
    autoEnableProjectId?: string;
}

export interface LocalSourceInstallRequest {
    localPath: string;
    sourceLabel: string;
    pluginName?: string;
    actorId: string;
    description?: string;
    autoEnableProjectId?: string;
}

export interface PluginChangeEvent {
    type: "enabled" | "removed";
    name: string;
    projectId?: string;
}

export interface InspectedLocalSkillSource {
    resolvedLocalPath: string;
    resolvedPluginName: string;
    manifestName?: string;
    manifestDescription?: string;
}

export interface SkillNameValidationResult {
    ok: boolean;
    normalizedName?: string;
    reason?: string;
}


export class PluginService {
    private readonly log = createLogger("plugin");

    private readonly canonicalStore: string;
    private readonly stagingStore: string;
    private onPluginChange?: (event: PluginChangeEvent) => void;

    constructor(
        private readonly baseCwd: string,
        private readonly catalogStore?: PluginCatalogStore,
        private readonly adapters?: {
            gitClone?: (source: string, targetDir: string) => Promise<void>;
            localArchiveResolve?: (archivePath: string, tempDir: string) => Promise<string>;
        },
        private readonly adminStateStore?: Pick<AdminStateStore, "read" | "write">,
        private readonly gitOps?: GitOps,
    ) {
        this.canonicalStore = resolvePluginCanonicalStore(baseCwd);
        this.stagingStore = resolvePluginStagingRoot(baseCwd);
    }

    setOnPluginChange(fn: (event: PluginChangeEvent) => void): void {
        this.onPluginChange = fn;
    }

    getCanonicalStorePath(): string {
        return this.canonicalStore;
    }

    getStagingStorePath(): string {
        return this.stagingStore;
    }

    async allocateStagingDir(scope: PluginStagingScope, actorId: string): Promise<string> {
        await mkdir(this.stagingStore, { recursive: true });
        const dir = join(this.stagingStore, buildPluginStagingDirName(scope, actorId));
        await mkdir(dir, { recursive: true });
        return dir;
    }

    validateSkillNameCandidate(rawName: string): SkillNameValidationResult {
        const trimmed = rawName.trim();
        if (!trimmed) {
            return { ok: false, reason: "Skill 名称不能为空" };
        }
        const normalizedName = normalizePluginName(trimmed);
        if (!normalizedName) {
            return { ok: false, reason: "Skill 名称不能为空" };
        }
        if (normalizedName !== trimmed) {
            return {
                ok: false,
                reason: "Skill 名称只允许字母、数字、点、下划线、中划线，且不能以分隔符开头或结尾",
            };
        }
        const catalogEntry = this.catalogStore?.get(normalizedName);
        const canonicalPath = join(this.canonicalStore, normalizedName);
        const catalogInstalled = Boolean(
            catalogEntry
            && catalogEntry.downloadStatus === "downloaded"
            && existsSync(catalogEntry.contentPath)
        );
        if (catalogInstalled || existsSync(canonicalPath)) {
            return { ok: false, normalizedName, reason: `Skill "${normalizedName}" 已存在` };
        }
        return { ok: true, normalizedName };
    }

    private readProjects(): ProjectRecord[] {
        return this.adminStateStore?.read().projects ?? [];
    }

    private requireProject(projectId: string): ProjectRecord {
        const project = this.readProjects().find((item) => item.id === projectId);
        if (!project) {
            throw new Error(`project not found: ${projectId}`);
        }
        return project;
    }

    private updateProject(projectId: string, mutate: (project: ProjectRecord) => void): ProjectRecord {
        if (!this.adminStateStore) {
            throw new Error("adminStateStore is required for project skill operations");
        }
        const state = this.adminStateStore.read();
        const project = state.projects.find((item) => item.id === projectId);
        if (!project) {
            throw new Error(`project not found: ${projectId}`);
        }
        mutate(project);
        project.enabledSkills = [...new Set((project.enabledSkills ?? []).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        project.updatedAt = new Date().toISOString();
        this.adminStateStore.write(state);
        return project;
    }

    private getProjectEnabledSkills(projectId: string): string[] {
        return [...(this.requireProject(projectId).enabledSkills ?? [])];
    }

    private async syncProjectBackendLinks(project: ProjectRecord): Promise<void> {
        const enabled = new Set(project.enabledSkills ?? []);
        for (const backendDir of ALL_BACKEND_SKILL_DIRS) {
            const projectSkillDir = pathResolve(project.cwd, backendDir);
            await mkdir(projectSkillDir, { recursive: true });
            const entries = await readdir(projectSkillDir, { withFileTypes: true }).catch(() => []);
            for (const entry of entries) {
                if (!enabled.has(entry.name)) {
                    await rm(join(projectSkillDir, entry.name), { recursive: true, force: true }).catch(() => undefined);
                }
            }
            for (const skillName of enabled) {
                const catalogEntry = this.catalogStore?.get(skillName);
                const sourcePath = catalogEntry?.contentPath ?? join(this.canonicalStore, skillName);
                if (!(await stat(sourcePath).catch(() => null))) {
                    throw new Error(`Skill "${skillName}" 尚未安装到系统`);
                }
                const linkPath = join(projectSkillDir, skillName);
                try {
                    const current = await realpath(linkPath).catch(() => null);
                    const desired = await realpath(sourcePath).catch(() => pathResolve(sourcePath));
                    if (current === desired) {
                        continue;
                    }
                    await rm(linkPath, { recursive: true, force: true });
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                }
                const relPath = relative(projectSkillDir, sourcePath);
                await symlink(relPath, linkPath, "dir");
            }
        }
    }

    async syncProjectSkills(projectId: string): Promise<void> {
        if (!this.adminStateStore) {
            return;
        }
        const project = this.requireProject(projectId);
        await this.syncProjectBackendLinks(project);
        const worktrees = await this.gitOps!.worktree.list(project.cwd).catch(() => []);
        for (const worktree of worktrees) {
            if (worktree.path === project.cwd) continue;
            for (const backendDir of ALL_BACKEND_SKILL_DIRS) {
                await this.gitOps!.worktree.ensurePluginSymlink(project.cwd, worktree.path, backendDir);
            }
        }
    }

    async ensureProjectThreadSkills(projectId: string, threadName: string): Promise<void> {
        if (!this.adminStateStore) {
            return;
        }
        const project = this.requireProject(projectId);
        await this.syncProjectBackendLinks(project);
        const worktreePath = this.gitOps!.worktree.getPath(project.cwd, threadName);
        for (const backendDir of ALL_BACKEND_SKILL_DIRS) {
            await this.gitOps!.worktree.ensurePluginSymlink(project.cwd, worktreePath, backendDir);
        }
    }

    async importFromGithubSubpath(input: GithubSubpathImportRequest): Promise<PluginDefinition> {
        const tempDir = join(this.canonicalStore, `.tmp-import-${Date.now()}`);
        await mkdir(this.canonicalStore, { recursive: true });
        await (this.adapters?.gitClone ?? this.gitOps!.repo.shallowClone)(input.repoUrl, tempDir);
        try {
            const relativeSkillPath = normalizeSubpath(input.skillSubpath);
            const definition = await this.installFromResolvedLocalSource({
                localPath: join(tempDir, relativeSkillPath),
                pluginName: input.pluginName || basename(relativeSkillPath),
                sourceLabel: `${input.repoUrl}#${relativeSkillPath}`,
                actorId: input.actorId,
                description: input.description,
                autoEnableProjectId: input.autoEnableProjectId,
                sourceType: "github-subpath",
                skillSubpath: relativeSkillPath,
            });
            return definition;
        } finally {
            await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    async installFromLocalSource(input: LocalSourceInstallRequest): Promise<PluginDefinition> {
        return this.installFromResolvedLocalSource({
            localPath: input.localPath,
            pluginName: input.pluginName,
            sourceLabel: input.sourceLabel,
            actorId: input.actorId,
            description: input.description,
            autoEnableProjectId: input.autoEnableProjectId,
            sourceType: "feishu-upload",
        });
    }

    async inspectLocalSource(input: {
        localPath: string;
        sourceType?: PluginSourceType;
        preferredPluginName?: string;
        extractionDir?: string;
    }): Promise<InspectedLocalSkillSource> {
        const sourceType = input.sourceType ?? "feishu-upload";
        const resolvedPath = pathResolve(input.localPath);
        const archiveImport = isArchivePath(resolvedPath);
        const extractionDir = archiveImport
            ? (input.extractionDir ?? join(this.stagingStore, `.tmp-inspect-${Date.now()}`))
            : undefined;
        const skillRoot = archiveImport
            ? await (this.adapters?.localArchiveResolve
                ? this.adapters.localArchiveResolve(resolvedPath, extractionDir!)
                : extractSkillArchiveToTemp(resolvedPath, extractionDir!))
            : resolvedPath;
        await ensureSkillRoot(skillRoot);
        const manifest = await readSkillManifest(skillRoot);
        const resolvedPluginName = normalizePluginName(
            input.preferredPluginName
            || manifest.name
            || derivePluginName(resolvedPath, sourceType)
        );
        if (!resolvedPluginName) {
            throw new Error("Skill 名称不能为空");
        }
        return {
            resolvedLocalPath: skillRoot,
            resolvedPluginName,
            manifestName: manifest.name,
            manifestDescription: manifest.description,
        };
    }

    async install(source: string, projectId?: string, actorId = "system"): Promise<PluginDefinition> {
        const pluginName = normalizePluginName(source);
        if (!pluginName) {
            throw new Error("Skill 名称不能为空");
        }
        if (!projectId) {
            throw new Error("projectId is required to enable a skill");
        }
        const catalogEntry = this.catalogStore?.get(pluginName);
        const canonicalPath = catalogEntry?.contentPath ?? join(this.canonicalStore, pluginName);
        if (!existsSync(canonicalPath)) {
            throw new Error(`Skill "${pluginName}" 尚未安装到系统`);
        }
        this.log.info({ projectId, pluginName, actorId }, "install skill to project");
        await this.bindToProject(projectId, pluginName, actorId);
        return this.readPluginDefinition(canonicalPath, pluginName);
    }

    async bindToProject(projectId: string, pluginName: string, actorId: string): Promise<void> {
        const canonicalPath = join(this.canonicalStore, pluginName);
        if (!existsSync(canonicalPath)) {
            throw new Error(`Skill "${pluginName}" 尚未安装到系统`);
        }
        const beforeEnabled = new Set(this.getProjectEnabledSkills(projectId));
        const alreadyEnabled = beforeEnabled.has(pluginName);
        this.log.info({ projectId, pluginName, actorId, alreadyEnabled }, "bind skill to project: start");
        this.updateProject(projectId, (project) => {
            project.enabledSkills = [...(project.enabledSkills ?? []), pluginName];
        });
        await this.syncProjectSkills(projectId);
        this.onPluginChange?.({ type: "enabled", name: pluginName, projectId });
        this.log.info({ projectId, pluginName, actorId, alreadyEnabled }, "bind skill to project: success");
    }

    async unbindFromProject(projectId: string, pluginName: string): Promise<boolean> {
        let changed = false;
        this.log.info({ projectId, pluginName }, "unbind skill from project: start");
        this.updateProject(projectId, (project) => {
            const before = new Set(project.enabledSkills ?? []);
            before.delete(pluginName);
            const next = [...before];
            changed = next.length !== (project.enabledSkills ?? []).length;
            project.enabledSkills = next;
        });
        await this.syncProjectSkills(projectId);
        this.log.info({ projectId, pluginName, changed }, "unbind skill from project: success");
        return changed;
    }

    async list(): Promise<PluginDefinition[]> {
        const entries = this.catalogStore?.list() ?? [];
        if (entries.length > 0) {
            const result: PluginDefinition[] = [];
            for (const entry of entries) {
                if (entry.downloadStatus !== "downloaded") continue;
                try {
                    result.push(await this.readPluginDefinition(entry.contentPath, entry.pluginName));
                } catch { /* ignore malformed */ }
            }
            return result;
        }
        try {
            const dirents = await readdir(this.canonicalStore, { withFileTypes: true });
            const result: PluginDefinition[] = [];
            for (const dirent of dirents) {
                if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue;
                try {
                    result.push(await this.readPluginDefinition(join(this.canonicalStore, dirent.name), "unknown"));
                } catch { /* ignore malformed */ }
            }
            return result;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw err;
        }
    }

    listCatalog(): PluginCatalogEntry[] {
        return this.catalogStore?.list() ?? [];
    }

    listProjectBindings(projectId: string) {
        return this.getProjectEnabledSkills(projectId).map((pluginName) => ({
            projectId,
            pluginName,
            enabledAt: "",
            enabledBy: ""
        }));
    }

    async listProjectPlugins(projectId: string): Promise<ProjectPluginDefinition[]> {
        const bindings = new Set(this.getProjectEnabledSkills(projectId));
        const catalogEntries = this.catalogStore?.list() ?? [];
        const catalog = new Map(catalogEntries.map((entry) => [entry.pluginName, entry]));
        const names = new Set<string>([...bindings.keys(), ...catalog.keys()]);
        const results: ProjectPluginDefinition[] = [];

        for (const pluginName of names) {
            const catalogEntry = catalog.get(pluginName);
            const source = pluginName;
            const sourceType = (catalogEntry?.sourceType ?? "github-subpath") as PluginSourceType;
            const path = catalogEntry?.contentPath ?? join(this.canonicalStore, pluginName);
            let definition: PluginDefinition = {
                name: catalogEntry?.displayName ?? pluginName,
                description: catalogEntry?.description ?? "",
                path,
                source,
                hasScripts: false,
                hasData: false,
                mcpServers: [],
            };
            if (catalogEntry?.downloadStatus === "downloaded" && existsSync(path)) {
                try {
                    definition = await this.readPluginDefinition(path, source);
                } catch { /* ignore malformed */ }
            }
            results.push({
                ...definition,
                pluginName,
                sourceType,
                skillSubpath: catalogEntry?.skillSubpath,
                downloaded: catalogEntry?.downloadStatus === "downloaded" && existsSync(path),
                enabled: bindings.has(pluginName),
                downloadedBy: catalogEntry?.downloadedBy,
                downloadedAt: catalogEntry?.downloadedAt,
            });
        }

        return results.sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.downloaded) - Number(a.downloaded) || a.pluginName.localeCompare(b.pluginName));
    }

    async remove(name: string): Promise<boolean> {
        const referencedBy = this.readProjects()
            .filter((project) => (project.enabledSkills ?? []).includes(name))
            .map((project) => project.id);
        if (referencedBy.length > 0) {
            throw new Error(`Skill "${name}" 正被项目引用，禁止删除`);
        }
        const removedStore = this.catalogStore?.remove(name) ?? false;
        await rm(join(this.canonicalStore, name), { recursive: true, force: true }).catch(() => undefined);
        this.onPluginChange?.({ type: "removed", name });
        return removedStore || true;
    }
    async getInstallablePlugins(projectId?: string): Promise<Array<{
        pluginName: string;
        sourceType: PluginSourceType;
        name?: string;
        description?: string;
        installed: boolean;
        enabled?: boolean;
    }>> {
        const bound = new Set(projectId ? this.getProjectEnabledSkills(projectId) : []);
        const catalogEntries = (this.catalogStore?.list() ?? []).filter((item) => item.downloadStatus === "downloaded");
        return catalogEntries.map((entry) => {
            const pluginName = entry.pluginName;
            return {
                sourceType: entry.sourceType,
                name: entry.displayName,
                description: entry.description,
                pluginName,
                installed: existsSync(join(this.canonicalStore, pluginName)),
                enabled: projectId ? bound.has(pluginName) : undefined,
            };
        });
    }

    async collectMcpServers(projectId?: string): Promise<McpServerDecl[]> {
        const plugins = projectId ? await this.listProjectPlugins(projectId) : await this.list();
        const servers: McpServerDecl[] = [];
        for (const plugin of plugins) {
            if ("enabled" in plugin && !plugin.enabled) continue;
            if (plugin.mcpServers.length > 0) {
                servers.push(...plugin.mcpServers);
            }
        }
        return servers;
    }

    private async installFromResolvedLocalSource(input: {
        localPath: string;
        pluginName?: string;
        sourceLabel: string;
        actorId: string;
        description?: string;
        autoEnableProjectId?: string;
        sourceType: PluginSourceType;
        skillSubpath?: string;
    }): Promise<PluginDefinition> {
        await mkdir(this.canonicalStore, { recursive: true });
        const tempDir = join(this.canonicalStore, `.tmp-local-${Date.now()}`);

        try {
            const inspected = await this.inspectLocalSource({
                localPath: input.localPath,
                sourceType: input.sourceType,
                preferredPluginName: input.pluginName,
                extractionDir: tempDir,
            });
            const pluginName = inspected.resolvedPluginName;
            const targetDir = join(this.canonicalStore, pluginName);
            await ensureDirMissing(targetDir, pluginName);
            return await this.importPreparedSkill({
                targetDir,
                pluginName,
                source: input.sourceLabel,
                sourceType: input.sourceType,
                skillRoot: inspected.resolvedLocalPath,
                actorId: input.actorId,
                displayName: pluginName,
                description: input.description ?? inspected.manifestDescription,
                autoEnableProjectId: input.autoEnableProjectId,
                skillSubpath: input.skillSubpath,
            });
        } catch (error) {
            const failedPluginName = input.pluginName ? normalizePluginName(input.pluginName) : undefined;
            if (failedPluginName) {
                const targetDir = join(this.canonicalStore, failedPluginName);
                await rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
                this.catalogStore?.upsert({
                    pluginName: failedPluginName,
                    sourceType: input.sourceType,
                    displayName: failedPluginName,
                    description: input.description,
                    contentPath: targetDir,
                    skillSubpath: input.skillSubpath,
                    downloadStatus: "failed",
                    downloadedAt: new Date().toISOString(),
                    downloadedBy: input.actorId,
                });
            }
            throw error;
        } finally {
            await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    private async readPluginDefinition(dirPath: string, source: string): Promise<PluginDefinition> {
        const skillMdPath = join(dirPath, "SKILL.md");
        const content = await readFile(skillMdPath, "utf-8");
        const meta = parsePluginFrontmatter(content);
        const name = meta.name || basename(dirPath);
        const description = meta.description || "";

        let hasScripts = false;
        let hasData = false;
        try {
            const children = await readdir(dirPath);
            hasScripts = children.includes("scripts");
            hasData = children.includes("data");
        } catch { /* ignore */ }

        return {
            name,
            description,
            path: dirPath,
            source,
            hasScripts,
            hasData,
            mcpServers: meta.mcp_servers ?? [],
        };
    }

    private async importPreparedSkill(input: {
        targetDir: string;
        pluginName: string;
        source: string;
        sourceType: PluginSourceType;
        skillRoot: string;
        actorId: string;
        displayName?: string;
        description?: string;
        autoEnableProjectId?: string;
        skillSubpath?: string;
    }): Promise<PluginDefinition> {
        await ensureSkillRoot(input.skillRoot);
        if (input.skillRoot !== input.targetDir) {
            await cp(input.skillRoot, input.targetDir, { recursive: true });
        }
        const definition = await this.readPluginDefinition(input.targetDir, input.source);
        this.catalogStore?.upsert({
            pluginName: input.pluginName,
            sourceType: input.sourceType,
            skillSubpath: input.skillSubpath,
            displayName: input.displayName ?? definition.name,
            description: input.description ?? definition.description,
            contentPath: input.targetDir,
            manifestHash: await hashManifest(join(input.targetDir, "SKILL.md")),
            downloadStatus: "downloaded",
            downloadedAt: new Date().toISOString(),
            downloadedBy: input.actorId,
        });
        if (input.autoEnableProjectId) {
            await this.bindToProject(input.autoEnableProjectId, input.pluginName, input.actorId);
        }
        return definition;
    }
}

async function ensureDirMissing(targetDir: string, pluginName: string): Promise<void> {
    try {
        const s = await stat(targetDir);
        if (s.isDirectory()) throw new Error(`Plugin "${pluginName}" 已存在于 canonical store`);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
}

async function hashManifest(skillMdPath: string): Promise<string> {
    const content = await readFile(skillMdPath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
}

async function readSkillManifest(dirPath: string): Promise<{ name?: string; description?: string }> {
    const content = await readFile(join(dirPath, "SKILL.md"), "utf-8");
    const meta = parsePluginFrontmatter(content);
    return {
        name: meta.name?.trim() || undefined,
        description: meta.description?.trim() || undefined,
    };
}

async function ensureSkillRoot(skillRoot: string): Promise<void> {
    try {
        const dirStat = await stat(skillRoot);
        if (!dirStat.isDirectory()) {
            throw new Error("not-a-directory");
        }
        const s = await stat(join(skillRoot, "SKILL.md"));
        if (!s.isFile()) throw new Error("missing");
    } catch {
        throw new Error(`目标路径 ${skillRoot} 下未找到 SKILL.md`);
    }
}


async function extractSkillArchiveToTemp(archivePath: string, tempDir: string): Promise<string> {
    await mkdir(tempDir, { recursive: true });
    await validateArchiveEntries(archivePath);
    if (/\.zip$/i.test(archivePath)) {
        await extractZipArchive(archivePath, tempDir);
    } else {
        await tar.x({ file: archivePath, cwd: tempDir, strict: true });
    }
    return await locateSingleSkillRoot(tempDir);
}

async function validateArchiveEntries(archivePath: string): Promise<void> {
    const entries = await listArchiveEntries(archivePath);
    for (const rawEntry of entries) {
        const entry = rawEntry.trim();
        if (!entry) continue;
        if (entry.startsWith("/") || entry.includes("..") || entry.includes("\\..") || /^[A-Za-z]:/.test(entry)) {
            throw new Error(`压缩包包含非法路径: ${entry}`);
        }
    }
}

async function listArchiveEntries(archivePath: string): Promise<string[]> {
    if (/\.zip$/i.test(archivePath)) {
        const zip = await JSZip.loadAsync(await readFile(archivePath));
        return Object.keys(zip.files);
    }
    const entries: string[] = [];
    await tar.t({
        file: archivePath,
        onentry: (entry: { path: string }) => {
            entries.push(entry.path);
        }
    });
    return entries;
}

async function locateSingleSkillRoot(rootDir: string): Promise<string> {
    const matches: string[] = [];
    const queue = [rootDir];
    const seen = new Set<string>();

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (seen.has(current)) continue;
        seen.add(current);
        let dirents: Array<{ isDirectory(): boolean; name: string }>;
        try {
            dirents = (await readdir(current, { withFileTypes: true })) as Array<{ isDirectory(): boolean; name: string }>;
        } catch {
            continue;
        }
        if (dirents.some((dirent) => !dirent.isDirectory() && dirent.name === "SKILL.md")) {
            matches.push(current);
            continue;
        }
        for (const dirent of dirents) {
            if (!dirent.isDirectory() || dirent.name === "__MACOSX") continue;
            queue.push(join(current, dirent.name));
        }
    }

    if (matches.length === 0) {
        throw new Error("压缩包中未找到包含 SKILL.md 的 Skill 目录");
    }
    if (matches.length > 1) {
        throw new Error("压缩包中找到多个 Skill 目录，请只提供单个 Skill");
    }
    return matches[0]!;
}

async function extractZipArchive(archivePath: string, targetDir: string): Promise<void> {
    const zip = await JSZip.loadAsync(await readFile(archivePath));
    for (const [entryName, entry] of Object.entries(zip.files)) {
        const normalized = entryName.replace(/\\/g, "/");
        if (!normalized || normalized.endsWith("/")) {
            await mkdir(join(targetDir, normalized), { recursive: true });
            continue;
        }
        const outputPath = join(targetDir, normalized);
        await mkdir(dirname(outputPath), { recursive: true });
        const content = await entry.async("nodebuffer");
        await writeFile(outputPath, content);
    }
}
