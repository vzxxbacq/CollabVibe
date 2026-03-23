import { describe, expect, it } from "vitest";

import { parseClaudeConfigContent, parseCodexConfigContent, parseOpenCodeConfigContent, parseSimpleToml } from "../../backend/config-parsers";

describe("backend config parsers", () => {
  it("parses simple toml", () => {
    expect(parseSimpleToml('model = "gpt-5"\n[profiles.fast]\nmodel = "gpt-5-mini"')).toEqual({
      "": { model: "gpt-5" },
      "profiles.fast": { model: "gpt-5-mini" },
    });
  });

  it("parses codex config content", () => {
    const result = parseCodexConfigContent({
      content: [
        'model_provider = "openai"',
        'model = "gpt-5"',
        '[model_providers.openai]',
        'base_url = "https://api.openai.com/v1"',
        'env_key = "OPENAI_API_KEY"',
        '[profiles.fast]',
        'model = "gpt-5-mini"',
        'model_provider = "openai"',
      ].join("\n"),
      getExistingStatuses: () => [],
      envReader: () => "set",
    });

    expect(result.activeProvider).toBe("openai");
    expect(result.providerMap.get("openai")?.apiKeySet).toBe(true);
    expect(result.providerMap.get("openai")?.models[0]).toEqual(expect.objectContaining({
      name: "fast",
      modelId: "gpt-5-mini",
    }));
  });

  it("parses claude config content", () => {
    const result = parseClaudeConfigContent({
      content: JSON.stringify({ model: "claude-sonnet-4" }),
      getExistingStatuses: () => [],
      envReader: () => "set",
    });
    expect(result.activeProvider).toBe("anthropic");
    expect(result.providers[0]?.models[0]?.name).toBe("claude-sonnet-4");
  });

  it("parses opencode config content", () => {
    const result = parseOpenCodeConfigContent({
      content: JSON.stringify({
        permission: { question: "ask me" },
        provider: {
          openai: {
            options: { baseURL: "https://api.openai.com/v1", apiKey: "$OPENAI_API_KEY" },
            models: {
              "gpt-5": { name: "GPT-5", limit: { context: 1000 } }
            }
          }
        }
      }),
      getExistingStatuses: () => [],
      resolveApiKey: () => "set",
    });

    expect(result.policy).toEqual({ permission_question: "ask me" });
    expect(result.providers[0]).toEqual(expect.objectContaining({
      name: "openai",
      apiKeyEnv: "OPENAI_API_KEY",
      apiKeySet: true,
    }));
    expect(result.providers[0]?.models[0]).toEqual(expect.objectContaining({
      name: "GPT-5",
      modelId: "gpt-5",
    }));
  });
});
