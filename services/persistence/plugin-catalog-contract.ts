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
  upsert(entry: PluginCatalogEntry): Promise<void>;
  get(pluginName: string): Promise<PluginCatalogEntry | null>;
  list(): Promise<PluginCatalogEntry[]>;
  remove(pluginName: string): Promise<boolean>;
}
