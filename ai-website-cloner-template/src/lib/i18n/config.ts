export const locales = ["zh-CN", "zh-TW", "en", "ja-JP", "ar"] as const;
export type Locale = typeof locales[number];
export const markets = ["china", "taiwan", "global", "japan", "arab"] as const;
export type Market = typeof markets[number];
export type Preferences = { locale: Locale; market: Market; output_locale?: Locale };
export const localeForMarket: Record<Market, Locale> = { china: "zh-CN", taiwan: "zh-TW", japan: "ja-JP", arab: "ar", global: "en" };
export const marketForLocale: Record<Locale, Market> = { "zh-CN": "china", "zh-TW": "china", en: "global", "ja-JP": "japan", ar: "arab" };
export function preferencesForCountry(country: string): Preferences {
  const market = marketForCountry(country);
  return { market, locale: ["HK", "MO", "TW"].includes(country.toUpperCase()) ? "zh-TW" : localeForMarket[market] };
}
export const arabCountries = new Set(["AE", "SA", "BH", "KW", "QA", "OM", "YE", "IQ", "JO", "LB", "PS", "SY", "EG", "SD", "LY", "TN", "DZ", "MA", "MR", "SO", "DJ", "KM"]);
export function marketForCountry(country: string): Market {
  const code = country.toUpperCase();
  return code === "TW" ? "taiwan" : ["CN", "HK", "MO"].includes(code) ? "china" : code === "JP" ? "japan" : arabCountries.has(code) ? "arab" : "global";
}
export function parsePreferences(value?: string): Preferences | undefined {
  const parts = (value || "").split("~");
  if (parts.length !== 2 && parts.length !== 3) return undefined;
  const [locale, market, output] = parts;
  if (!locales.includes(locale as Locale) || !markets.includes(market as Market) || (parts.length === 3 && !locales.includes(output as Locale))) return undefined;
  return { locale: locale as Locale, market: market as Market, ...(output ? { output_locale: output as Locale } : {}) };
}
export function serializePreferences(value: Preferences) {
  return `${value.locale}~${value.market}${value.output_locale ? `~${value.output_locale}` : ""}`;
}
export function browserPreferences(): Preferences {
  if (typeof document === "undefined") return { locale: "zh-CN", market: "china" };
  return parsePreferences(document.cookie.split("; ").find(row => row.startsWith("plotloom-preferences="))?.split("=")[1]) || { locale: document.documentElement.lang as Locale || "en", market: document.documentElement.dataset.market as Market || "global", output_locale: document.documentElement.dataset.outputLocale as Locale || document.documentElement.lang as Locale || "en" };
}
