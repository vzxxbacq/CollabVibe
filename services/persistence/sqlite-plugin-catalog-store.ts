import type { AsyncDatabaseProxy } from "./async-database-proxy";

import type {
  PluginCatalogEntry,
  PluginCatalogStore,
  PluginSourceType,
} from "./contracts";

interface PluginCatalogRow {
  plugin_name: string;
  source_type: string;
  skill_subpath: string | null;
  display_name: string | null;
  description: string | null;
  content_path: string;
  manifest_hash: string | null;
  download_status: string;
  downloaded_at: string;
  downloaded_by: string;
}

export class SqlitePluginCatalogStore implements PluginCatalogStore {
  constructor(private readonly db: AsyncDatabaseProxy) {}

  async init(): Promise<void> {
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS plugin_catalog (
        plugin_name TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        skill_subpath TEXT,
        display_name TEXT,
        description TEXT,
        content_path TEXT NOT NULL,
        manifest_hash TEXT,
        download_status TEXT NOT NULL,
        downloaded_at TEXT NOT NULL,
        downloaded_by TEXT NOT NULL
      );`
    );
  }

  async upsert(entry: PluginCatalogEntry): Promise<void> {
    await this.db.prepare(
      `INSERT INTO plugin_catalog (
        plugin_name, source_type, skill_subpath, display_name, description,
        content_path, manifest_hash, download_status, downloaded_at, downloaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plugin_name) DO UPDATE SET
        source_type = excluded.source_type,
        skill_subpath = excluded.skill_subpath,
        display_name = excluded.display_name,
        description = excluded.description,
        content_path = excluded.content_path,
        manifest_hash = excluded.manifest_hash,
        download_status = excluded.download_status,
        downloaded_at = excluded.downloaded_at,
        downloaded_by = excluded.downloaded_by`
    ).run(
      entry.pluginName,
      entry.sourceType,
      entry.skillSubpath ?? null,
      entry.displayName ?? null,
      entry.description ?? null,
      entry.contentPath,
      entry.manifestHash ?? null,
      entry.downloadStatus,
      entry.downloadedAt,
      entry.downloadedBy,
    );
  }

  async get(pluginName: string): Promise<PluginCatalogEntry | null> {
    const row = await this.db.get(
      `SELECT plugin_name, source_type, skill_subpath, display_name, description,
              content_path, manifest_hash, download_status, downloaded_at, downloaded_by
       FROM plugin_catalog WHERE plugin_name = ?`,
      pluginName,
    ) as PluginCatalogRow | undefined;
    return row ? mapCatalogRow(row) : null;
  }

  async list(): Promise<PluginCatalogEntry[]> {
    const rows = await this.db.all(
      `SELECT plugin_name, source_type, skill_subpath, display_name, description,
              content_path, manifest_hash, download_status, downloaded_at, downloaded_by
       FROM plugin_catalog
       ORDER BY downloaded_at DESC`,
    ) as PluginCatalogRow[];
    return rows.map(mapCatalogRow);
  }

  async remove(pluginName: string): Promise<boolean> {
    const result = await this.db.run("DELETE FROM plugin_catalog WHERE plugin_name = ?", pluginName);
    return result.changes > 0;
  }
}

function mapCatalogRow(row: PluginCatalogRow): PluginCatalogEntry {
  return {
    pluginName: row.plugin_name,
    sourceType: row.source_type as PluginSourceType,
    skillSubpath: row.skill_subpath ?? undefined,
    displayName: row.display_name ?? undefined,
    description: row.description ?? undefined,
    contentPath: row.content_path,
    manifestHash: row.manifest_hash ?? undefined,
    downloadStatus: row.download_status as "downloaded" | "failed",
    downloadedAt: row.downloaded_at,
    downloadedBy: row.downloaded_by,
  };
}
