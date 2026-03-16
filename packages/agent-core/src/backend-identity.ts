/**
 * @module packages/agent-core/src/backend-identity
 * @layer Core Types
 *
 * BackendIdentity — immutable value object representing a thread's backend binding.
 *
 * ## Design rationale
 * `transport` is derived from `backendId`, not stored independently.
 * This eliminates the class of bugs where `transport` is forgotten or
 * inconsistent with the backend that was selected.
 *
 * ## Usage
 * ```ts
 * const id = createBackendIdentity("opencode", "MiniMax-M2.5");
 * // id.transport === "acp"  (derived automatically)
 * ```
 */

/** All known backend engines — single source of truth */
export type BackendId = "codex" | "opencode" | "claude-code";

/** Transport protocol used to communicate with the backend process */
export type TransportType = "codex" | "acp";

/** Compile-time mapping: backend → transport */
const BACKEND_TRANSPORT: Record<BackendId, TransportType> = {
  "codex":       "codex",
  "opencode":    "acp",
  "claude-code": "acp",
};

/** Derive transport from a backend ID */
export function transportFor(backendId: BackendId): TransportType {
  return BACKEND_TRANSPORT[backendId];
}

/** Check if a string is a valid BackendId */
export function isBackendId(value: string): value is BackendId {
  return value in BACKEND_TRANSPORT;
}

/**
 * Thread's backend identity — frozen after creation.
 *
 * Invariants:
 *   - `backendId` determines `transport` (no independent override)
 *   - All fields are required (no undefined surprises)
 *   - Object is frozen (immutable)
 */
export interface BackendIdentity {
  readonly backendId: BackendId;
  readonly model: string;
  readonly transport: TransportType;
}

/**
 * Create a BackendIdentity — the ONLY way to construct one.
 * Automatically derives `transport` from `backendId`.
 */
export function createBackendIdentity(backendId: BackendId, model: string): BackendIdentity {
  return Object.freeze({
    backendId,
    model,
    transport: transportFor(backendId),
  });
}
