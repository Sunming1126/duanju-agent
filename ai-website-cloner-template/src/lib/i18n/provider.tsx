"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createTranslator } from "./translate";
import type { Preferences } from "./config";

const Context = createContext<Preferences>({ locale: "zh-CN", market: "china" });
export function LocaleProvider({ preferences, children }: { preferences: Preferences; children: ReactNode }) {
  return <Context.Provider value={preferences}>{children}</Context.Provider>;
}
export function usePreferences() { return useContext(Context); }
export function useUI() {
  const { locale } = usePreferences();
  return useMemo(() => createTranslator(locale), [locale]);
}
