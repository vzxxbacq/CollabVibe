/**
 * ESLint Configuration — 层级隔离规则
 *
 * 对应 docs/01-architecture/core-api.md §L1 Allowed Imports:
 *   ✅ services/contracts (仅 barrel: services/contracts/index.ts)
 *   ✅ services/orchestrator/src/index (OrchestratorLayer)
 *   ✅ packages/logger
 *   ❌ services/orchestrator/src/** (内部子模块)
 *   ❌ services/persistence/
 *   ❌ packages/agent-core/ (通过 contracts barrel re-export)
 *   ❌ packages/git-utils/
 *   ❌ services/contracts/ 子目录 (deep import)
 *
 * @see docs/01-architecture/core-api.md
 * @see AGENTS.md §2 四层架构与隔离约束
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  overrides: [
    // ── L0+L1 (src/) — Platform Modules ──
    {
      files: ["src/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              // ❌ 禁止 L1 深入 contracts 子目录（必须通过 barrel）
              {
                group: ["**/services/contracts/im/*"],
                message: "L1 must import from 'services/contracts' barrel (index.ts), not from contracts/im/ subdirectory.",
              },
              {
                group: ["**/services/contracts/admin/*"],
                message: "L1 must import from 'services/contracts' barrel (index.ts), not from contracts/admin/ subdirectory.",
              },
              {
                group: ["**/services/contracts/src/*"],
                message: "L1 must import from 'services/contracts' barrel (index.ts), not from contracts/src/ subdirectory.",
              },
              // ❌ 禁止 L1 直接 import orchestrator 内部
              {
                group: ["**/services/orchestrator/src/**", "!**/services/orchestrator/src/index"],
                message: "L1 must not import orchestrator internals. Use OrchestratorApi from contracts barrel.",
              },
              // ❌ 禁止 L1 import persistence
              {
                group: ["**/services/persistence/**"],
                message: "L1 must not import persistence layer (AGENTS.md §2).",
              },
              // ❌ 禁止 L1 直接 import agent-core（通过 contracts re-export）
              {
                group: ["**/packages/agent-core/**"],
                message: "L1 must not import agent-core directly. Use re-exports from contracts barrel.",
              },
              // ❌ 禁止 L1 import git-utils
              {
                group: ["**/packages/git-utils/**"],
                message: "L1 must not import git-utils (AGENTS.md §2).",
              },
              // ❌ 禁止跨平台 import
              {
                group: ["**/src/feishu/**"],
                message: "Cross-platform import forbidden: slack ↛ feishu (AGENTS.md §2).",
              },
              {
                group: ["**/src/slack/**"],
                message: "Cross-platform import forbidden: feishu ↛ slack (AGENTS.md §2).",
              },
            ],
          },
        ],
      },
    },
    // ── L2 contracts — 禁止反向 import orchestrator ──
    {
      files: ["services/contracts/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/services/orchestrator/**"],
                message: "contracts must NOT import from orchestrator (reverse dependency). Define types in contracts.",
              },
              {
                group: ["**/services/persistence/**"],
                message: "contracts must NOT import from persistence.",
              },
            ],
          },
        ],
      },
    },
    // ── L3 packages — 禁止 import L2 或 L0/L1 ──
    {
      files: ["packages/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/services/**"],
                message: "packages (L3) must NOT import from services (L2).",
              },
              {
                group: ["**/src/**"],
                message: "packages (L3) must NOT import from src (L0/L1).",
              },
            ],
          },
        ],
      },
    },
  ],
};
