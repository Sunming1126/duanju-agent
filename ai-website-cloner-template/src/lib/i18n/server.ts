import { headers } from "next/headers";
import { parsePreferences, type Preferences } from "./config";
import { createTranslator } from "./translate";
export async function serverI18n() {
  const requestHeaders = await headers();
  const preferences: Preferences = parsePreferences(requestHeaders.get("x-plotloom-preferences") || "") || { locale: "en", market: "global" };
  return { preferences, ui: createTranslator(preferences.locale) };
}
