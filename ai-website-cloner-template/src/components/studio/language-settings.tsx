"use client";
import { useState } from "react";
import { usePreferences, useUI } from "@/lib/i18n/provider";
import { locales, markets, localeForMarket, type Locale, type Market, type Preferences } from "@/lib/i18n/config";
import styles from "./space.module.css";

export const languageLabels = { "zh-CN": "中文", en: "英语", "ja-JP": "日语", ar: "阿拉伯语" };
export const marketLabels = { china: "中国", japan: "日本", arab: "阿拉伯地区", global: "国际／当前风格" };
function save(value?: Preferences) {
  document.cookie = `plotloom-preferences=${value ? `${value.locale}~${value.market}` : ""}; Path=/; Max-Age=${value ? 31536000 : 0}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  window.location.reload();
}
export function LanguageSettings() {
  const ui = useUI();
  const preferences = usePreferences();
  const [locale, setLocale] = useState(preferences.locale);
  const [market, setMarket] = useState(preferences.market);
  return <section className={styles.panel} aria-labelledby="language-heading">
    <div className={styles.sectionHeading}><h2 id="language-heading">{ui("界面语言与创作风格")}</h2></div>
    <p>{ui("首次访问按地区选择。手动设置保存在此浏览器；新作品使用所选风格和界面语言生成，已有作品可单独调整。")}</p>
    <div className="locale-settings-grid"><label>{ui("界面语言")}<select value={locale} onChange={e => setLocale(e.target.value as Locale)}>{locales.map(value => <option key={value} value={value}>{ui(languageLabels[value])}</option>)}</select></label><label>{ui("创作地区风格")}<select value={market} onChange={e => setMarket(e.target.value as Market)}>{markets.map(value => <option key={value} value={value}>{ui(marketLabels[value])}</option>)}</select></label></div>
    <div className="locale-settings-actions"><button className={styles.primary} onClick={() => save({ locale, market })}>{ui("保存偏好")}</button><button className={styles.textButton} onClick={() => save()}>{ui("恢复地区自动选择")}</button></div>
  </section>;
}
export function LanguageSwitcher() {
  const ui = useUI();
  const { locale } = usePreferences();
  return <select className="language-switcher" aria-label={ui("界面语言")} value={locale} onChange={e => {
    const nextLocale = e.target.value as Locale;
    save({ locale: nextLocale, market: markets.find(value => localeForMarket[value] === nextLocale)! });
  }}>{locales.map(value => <option key={value} value={value}>{ui(languageLabels[value])}</option>)}</select>;
}
export function WorkLanguageSettings({ market, locale, disabled, onChange }: { market: Market; locale: Locale; disabled?: boolean; onChange: (value: { market: Market; output_locale: Locale }) => void }) {
  const ui = useUI();
  return <fieldset className="work-language-settings" disabled={disabled}><legend>{ui("创作地区风格")}</legend><div className="locale-settings-grid"><label>{ui("创作地区风格")}<select value={market} onChange={e => onChange({ market: e.target.value as Market, output_locale: locale })}>{markets.map(value => <option key={value} value={value}>{ui(marketLabels[value])}</option>)}</select></label><label>{ui("输出语言")}<select value={locale} onChange={e => onChange({ market, output_locale: e.target.value as Locale })}>{locales.map(value => <option key={value} value={value}>{ui(languageLabels[value])}</option>)}</select></label></div><small>{ui("仅影响之后的生成，现有正文不会自动翻译。")}</small></fieldset>;
}
