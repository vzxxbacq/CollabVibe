/**
 * L3-internal default thread name fallback.
 * The canonical business constant is `MAIN_THREAD_NAME` in services/thread/constants.ts (L2).
 * L3 cannot import L2, so this private constant mirrors the same value for transport-level defaults.
 */
export const DEFAULT_THREAD_NAME = "__main__" as const;
