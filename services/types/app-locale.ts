/**
 * @module services/types/app-locale
 * @layer contracts (L2 boundary)
 *
 * Application locale type — single source of truth.
 * L1 imports via services/index; L2 imports directly.
 */

export const APP_LOCALES = ["zh-CN", "en-US"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";
