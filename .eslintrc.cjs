/**
 * ESLint Configuration — 层级隔离规则
 *
 * 对应 docs/01-architecture/core-api.md §L1 Allowed Imports:
 *   ✅ services/index (L2 唯一公开出口)
 *   ✅ services      (目录 import，解析到 services/index.ts)
 *   ✅ packages/logger/src/index
 *   ❌ services/**   (内部子模块；排除 services/index)
 *   ❌ packages/**   (L1 仅允许 logger)
 *   ❌ L2 直接 import packages 子模块（必须经各 package 的 src/index）
 *   ❌ package public index.ts 禁止 wildcard export
 *
 * @see docs/01-architecture/core-api.md
 * @see AGENTS.md §2 四层架构与隔离约束
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "import"],
  settings: {
    "import/resolver": {
      typescript: true,
      node: true
    }
  },
  rules: {
    "import/no-restricted-paths": [
      "error",
      {
        basePath: __dirname,
        zones: [
          // ── L0+L1 (src/) — Platform Modules ──
          // ❌ 禁止 L1 直接 import services 内部实现（仅允许 ../services 或 ../services/index）
          {
            target: "./src/**/*",
            from: "./services/**/*",
            except: ["**/services/index.*"],
            message: "L1 must import L2 only via 'services/index' (or directory import 'services'), not via services internals.",
          },
          // ❌ 禁止 L1 import persistence
          {
            target: "./src/**/*",
            from: "./services/persistence/**/*",
            message: "L1 must not import persistence layer (AGENTS.md §2).",
          },
          // ❌ 禁止 L1 直接 import agent-core（通过 contracts re-export）
          {
            target: "./src/**/*",
            from: "./packages/agent-core/**/*",
            message: "L1 must not import agent-core directly. Use re-exports from 'services/index'.",
          },
          // ❌ 禁止 L1 import git-utils
          {
            target: "./src/**/*",
            from: "./packages/git-utils/**/*",
            message: "L1 must not import git-utils (AGENTS.md §2).",
          },
          // ❌ 禁止跨平台 import
          {
            target: "./src/feishu/**/*",
            from: "./src/slack/**/*",
            message: "Cross-platform import forbidden: slack ↛ feishu (AGENTS.md §2).",
          },
          {
            target: "./src/slack/**/*",
            from: "./src/feishu/**/*",
            message: "Cross-platform import forbidden: feishu ↛ slack (AGENTS.md §2).",
          },
          // ── L3 packages — 禁止 import L2 或 L0/L1 ──
          {
            target: "./packages/**/*",
            from: "./services/**/*",
            message: "packages (L3) must NOT import from services (L2).",
          },
          {
            target: "./packages/**/*",
            from: "./src/**/*",
            message: "packages (L3) must NOT import from src (L0/L1).",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["src/**/*.ts"],
      excludedFiles: ["src/logging/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              // The following rules are now covered by import/no-restricted-paths:
              // {
              //   group: ["**/services/**", "!**/services/index"],
              //   message: "L1 must import L2 only via 'services/index' (or directory import 'services'), not via services internals.",
              // },
              // {
              //   group: ["**/src/feishu/**"],
              //   message: "Cross-platform import forbidden: slack ↛ feishu (AGENTS.md §2).",
              // },
              // {
              //   group: ["**/src/slack/**"],
              //   message: "Cross-platform import forbidden: feishu ↛ slack (AGENTS.md §2).",
              // },
              {
                group: ["**/packages/**"],
                message: "L1 must not import packages directly. Use approved public facades only.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["services/**/*.ts"],
      excludedFiles: ["services/tests/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/packages/*/src/**", "!**/packages/*/src/index"],
                message: "L2 must import packages only via each package's public src/index.ts.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["packages/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              // The following rules are now covered by import/no-restricted-paths:
              // {
              //   group: ["**/services/**"],
              //   message: "packages (L3) must NOT import from services (L2).",
              // },
              // {
              //   group: ["**/src/**"],
              //   message: "packages (L3) must NOT import from src (L0/L1).",
              // },
            ],
          },
        ],
      },
    },
    {
      files: ["packages/*/src/index.ts"],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector: "ExportAllDeclaration",
            message: "Package public index.ts must use explicit exports; wildcard exports are forbidden.",
          },
        ],
      },
    },
  ],
};
