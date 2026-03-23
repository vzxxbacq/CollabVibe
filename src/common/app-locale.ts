/**
 * @module src/common/app-locale
 * @layer L1 (platform-agnostic shared)
 *
 * Re-exports AppLocale type from L2 (single source of truth)
 * and provides runtime parsing/validation functions.
 */
import type { AppLocale } from "../../services/index";

export { APP_LOCALES, DEFAULT_APP_LOCALE } from "../../services/index";
export type { AppLocale } from "../../services/index";

const VALID_LOCALES: readonly string[] = ["zh-CN", "en-US"];
const FALLBACK_LOCALE: AppLocale = "zh-CN";

export function isAppLocale(value: string): value is AppLocale {
  return VALID_LOCALES.includes(value);
}

export function parseAppLocale(value?: string): AppLocale {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return FALLBACK_LOCALE;
  }
  if (!isAppLocale(normalized)) {
    throw new Error(`invalid APP_LOCALE: ${normalized}`);
  }
  return normalized;
}
