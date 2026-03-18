export type PluginSourceType =
  | "feishu-upload"
  | "github-subpath";

export interface PluginCatalogEntry {
  pluginName: string;
  sourceType: PluginSourceType;
  skillSubpath?: string;
  displayName?: string;
  description?: string;
  contentPath: string;
  manifestHash?: string;
  downloadStatus: "downloaded" | "failed";
  downloadedAt: string;
  downloadedBy: string;
}

export interface PluginCatalogStore {
  upsert(entry: PluginCatalogEntry): void;
  get(pluginName: string): PluginCatalogEntry | null;
  list(): PluginCatalogEntry[];
  remove(pluginName: string): boolean;
}
