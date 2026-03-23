import { describe, expect, it } from "vitest";

import { parsePluginFrontmatter, parsePluginYamlValue } from "../../plugin/plugin-manifest";
import { derivePluginName, normalizePluginName } from "../../plugin/plugin-name-policy";
import { isArchivePath, normalizeSubpath } from "../../plugin/plugin-path-policy";

describe("plugin manifest parser", () => {
  it("parses frontmatter fields and mcp servers", () => {
    const meta = parsePluginFrontmatter([
      "---",
      "name: demo-skill",
      "description: demo",
      "mcp_servers:",
      "- name: server-a",
      "  command: uvx",
      "---",
      "",
      "# body",
    ].join("\n"));

    expect(meta.name).toBe("demo-skill");
    expect(meta.description).toBe("demo");
    expect(meta.mcp_servers).toEqual([{ name: "server-a", command: "uvx" }]);
  });

  it("parses yaml-like values", () => {
    expect(parsePluginYamlValue("\"abc\"")).toBe("abc");
    expect(parsePluginYamlValue("[\"a\",\"b\"]")).toEqual(["a", "b"]);
  });
});

describe("plugin policies", () => {
  it("derives and normalizes plugin names", () => {
    expect(derivePluginName("https://x/y/demo-skill.git", "github-subpath")).toBe("demo-skill");
    expect(derivePluginName("/tmp/demo-skill.tar.gz", "feishu-upload")).toBe("demo-skill");
    expect(normalizePluginName(" Demo Skill! ")).toBe("Demo-Skill");
  });

  it("validates subpath and archive suffix", () => {
    expect(normalizeSubpath("./skills/demo")).toBe("skills/demo");
    expect(() => normalizeSubpath("../escape")).toThrow(/子路径非法/);
    expect(isArchivePath("demo.zip")).toBe(true);
    expect(isArchivePath("demo.txt")).toBe(false);
  });
});
