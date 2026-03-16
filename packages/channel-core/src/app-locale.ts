export const APP_LOCALES = ["zh-CN", "en-US"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";

export function isAppLocale(value: string): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value);
}

export function parseAppLocale(value?: string): AppLocale {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return DEFAULT_APP_LOCALE;
  }
  if (!isAppLocale(normalized)) {
    throw new Error(`invalid APP_LOCALE: ${normalized}`);
  }
  return normalized;
}
