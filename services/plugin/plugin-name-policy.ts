import { basename } from "node:path";

import type { PluginSourceType } from "../persistence/contracts";

export function derivePluginName(source: string, sourceType: PluginSourceType): string {
  switch (sourceType) {
    case "github-subpath":
      return basename(source).replace(/\.git$/, "");
    case "feishu-upload":
      return basename(source).replace(/\.(tar\.gz|tgz|zip)(\?.*)?$/i, "");
  }
}

export function normalizePluginName(name: string): string {
  return name.trim().replace(/[^a-z0-9._-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
