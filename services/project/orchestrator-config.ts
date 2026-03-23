// ─────────────────────────────────────────────────────────────────────────────
// OrchestratorConfig — L2 运行时配置接口
// ─────────────────────────────────────────────────────────────────────────────
//
// 定义 orchestrator 层所需的应用级配置子集。
// L0/L1 的 AppConfig (src/config.ts) 扩展此接口。
//
// 语义拆分自原 admin-state.ts（2026-03-22）。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subset of application config required by the orchestrator layer.
 * Defined at L2 (services) so orchestrator factory does not depend on L1 (src/config).
 * `AppConfig` in `src/config.ts` extends this interface.
 */
export interface OrchestratorConfig {
  cwd: string;
  /** Absolute path to the runtime data directory (logs, db, config). Derived from COLLABVIBE_WORKSPACE_CWD. */
  dataDir: string;
  sandbox: string;
  approvalPolicy: string;
  server: {
    port: number;
    approvalTimeoutMs: number;
    sysAdminUserIds: string[];
  };
}
