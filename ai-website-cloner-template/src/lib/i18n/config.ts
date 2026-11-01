export const locales = ["zh-CN", "en", "ja-JP", "ar"] as const;
export type Locale = typeof locales[number];
export const markets = ["china", "global", "japan", "arab"] as const;
export type Market = typeof markets[number];
export type Preferences = { locale: Locale; market: Market };
export const localeForMarket: Record<Market, Locale> = { china: "zh-CN", japan: "ja-JP", arab: "ar", global: "en" };
export const arabCountries = new Set(["AE", "SA", "BH", "KW", "QA", "OM", "YE", "IQ", "JO", "LB", "PS", "SY", "EG", "SD", "LY", "TN", "DZ", "MA", "MR", "SO", "DJ", "KM"]);
export function marketForCountry(country: string): Market {
  const code = country.toUpperCase();
  return ["CN", "HK", "MO", "TW"].includes(code) ? "china" : code === "JP" ? "japan" : arabCountries.has(code) ? "arab" : "global";
}
export function parsePreferences(value?: string): Preferences | undefined {
  const parts = (value || "").split("~");
  if (parts.length !== 2) return undefined;
  const [locale, market] = parts;
  return locales.includes(locale as Locale) && markets.includes(market as Market) ? { locale: locale as Locale, market: market as Market } : undefined;
}
export function browserPreferences(): Preferences {
  if (typeof document === "undefined") return { locale: "zh-CN", market: "china" };
  return parsePreferences(document.cookie.split("; ").find(row => row.startsWith("plotloom-preferences="))?.split("=")[1]) || { locale: document.documentElement.lang as Locale || "en", market: document.documentElement.dataset.market as Market || "global" };
}
