import { headers } from "next/headers";
import { parsePreferences } from "./config";
import { createTranslator } from "./translate";
export async function serverI18n() {
  const requestHeaders = await headers();
  const preferences = parsePreferences(requestHeaders.get("x-plotloom-preferences") || "") || { locale: "en", market: "global" } as const;
  return { preferences, ui: createTranslator(preferences.locale) };
}
