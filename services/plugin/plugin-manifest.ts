export interface McpServerDecl {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function parsePluginYamlValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

export function parsePluginFrontmatter(content: string): {
  name?: string;
  description?: string;
  mcp_servers?: McpServerDecl[];
} {
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const yaml = match[1]!;
  const result: Record<string, string> = {};
  const mcpServers: McpServerDecl[] = [];
  let inMcpBlock = false;
  let currentMcp: Partial<McpServerDecl> = {};

  for (const line of yaml.split("\n")) {
    const raw = line.replace(/\t/g, "  ");
    const trimmed = raw.trim();
    if (/^mcp_servers\s*:/.test(trimmed)) {
      inMcpBlock = true;
      continue;
    }
    if (inMcpBlock) {
      if (trimmed.startsWith("- ")) {
        if (currentMcp.name && currentMcp.command) {
          mcpServers.push(currentMcp as McpServerDecl);
        }
        currentMcp = {};
        const kv = /^-\s*(\w+)\s*:\s*(.+)$/.exec(trimmed);
        if (kv) {
          (currentMcp as Record<string, unknown>)[kv[1]!] = parsePluginYamlValue(kv[2]!);
        }
        continue;
      }
      const kv = /^(\w+)\s*:\s*(.+)$/.exec(trimmed);
      if (kv) {
        (currentMcp as Record<string, unknown>)[kv[1]!] = parsePluginYamlValue(kv[2]!);
        continue;
      }
      if (!trimmed) continue;
      inMcpBlock = false;
      if (currentMcp.name && currentMcp.command) {
        mcpServers.push(currentMcp as McpServerDecl);
      }
      currentMcp = {};
    }
    const kv = /^(\w+)\s*:\s*(.+)$/.exec(trimmed);
    if (kv) result[kv[1]!] = String(parsePluginYamlValue(kv[2]!));
  }
  if (currentMcp.name && currentMcp.command) {
    mcpServers.push(currentMcp as McpServerDecl);
  }
  return { ...result, mcp_servers: mcpServers.length > 0 ? mcpServers : undefined };
}
