/**
 * @module packages/agent-core/src/backend-config-types
 * @layer Core Types
 *
 * Unified types for backend model configuration.
 * IM layers (Feishu, Slack, …) construct these types from user input;
 * config-service consumes them and handles per-backend file format differences.
 *
 * ## Cross-platform contract
 * These types are the ONLY contract between IM layers and config-service.
 * IM layers do NOT need to know about TOML, JSON, or env-var conventions.
 */

import type { BackendId } from "./backend-identity";

// ── Provider ─────────────────────────────────────────────────────────────────

/**
 * Unified provider input — all backends express providers with these fields.
 *
 * How each backend maps them:
 * - Codex TOML:   `[providers.{name}]` with base_url, wire_api, env_key, api_key
 * - OpenCode JSON: `provider.{name}.options.{baseURL, apiKey}`
 * - Claude Code:   `providers.{name}.{baseUrl, apiKey}`
 */
export interface UnifiedProviderInput {
  /** Provider name (e.g. "codex", "阿里云", "minimax") */
  name: string;
  /** API endpoint URL */
  baseUrl: string;
  /** Plaintext API key (stored in data/config/, injected at runtime) */
  apiKey: string;
  /** Codex only: wire API type ("responses" | "chat") */
  wireApi?: string;
  /** Codex only: env var name for the API key (e.g. "CODEX_API_KEY") */
  envKeyName?: string;
}

// ── Profile ──────────────────────────────────────────────────────────────────

/**
 * Unified profile input — bundles model + backend-specific parameters.
 *
 * `extras` is transparently passed through to the backend's native config
 * format. config-service does NOT interpret these fields; it only serializes
 * them into the correct format per backend.
 *
 * Example extras by backend:
 * - Codex:      { model_reasoning_effort: "high", personality: "pragmatic" }
 * - OpenCode:   { modalities: {…}, options: { thinking: {…} }, limit: {…} }
 * - Claude Code: {} (typically empty)
 */
export interface UnifiedProfileInput {
  /** Profile name (e.g. "default", "5.3-high", "5.3-low-friendly") */
  name: string;
  /** Model identifier */
  model: string;
  /** Associated provider name (must exist in the same backend) */
  provider: string;
  /** Backend-specific parameters — transparently serialized, never interpreted */
  extras: Record<string, unknown>;
}

// ── Backend Config Data (read output) ────────────────────────────────────────

/** A provider as stored in data/config/* */
export interface StoredProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  wireApi?: string;
  envKeyName?: string;
}

/** A profile as stored in data/config/* */
export interface StoredProfile {
  name: string;
  model: string;
  provider: string;
  extras: Record<string, unknown>;
}

/**
 * Full config data for a single backend, read from data/config/*.
 * This is the normalized representation used internally by config-service.
 */
export interface BackendConfigData {
  backendId: BackendId;
  providers: StoredProvider[];
  profiles: StoredProfile[];
}

// ── Deploy / ServerCmd output ────────────────────────────────────────────────

/**
 * Result of buildCodexServerCmd() — CLI flags + env vars to inject.
 */
export interface CodexServerCmdResult {
  /** Complete serverCmd string including all -c flags */
  serverCmd: string;
  /** Env vars to inject (e.g. { CODEX_API_KEY: "sk-xxx" }) */
  env: Record<string, string>;
}
