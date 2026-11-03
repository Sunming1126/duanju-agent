"use client";
import { useState } from "react";
import { usePreferences, useUI } from "@/lib/i18n/provider";
import { locales, markets, localeForMarket, serializePreferences, type Locale, type Market, type Preferences } from "@/lib/i18n/config";
import styles from "./space.module.css";

export const languageLabels = { "zh-CN": "简体中文", "zh-TW": "繁体中文", en: "英语", "ja-JP": "日语", ar: "阿拉伯语" };
export const marketLabels = { china: "中国内地", taiwan: "台湾", japan: "日本", arab: "阿拉伯地区", global: "国际／当前风格" };
function save(value?: Preferences) {
  document.cookie = `plotloom-preferences=${value ? serializePreferences(value) : ""}; Path=/; Max-Age=${value ? 31536000 : 0}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  window.location.reload();
}
export function LanguageSettings() {
  const ui = useUI();
  const preferences = usePreferences();
  const [locale, setLocale] = useState(preferences.locale);
  const [market, setMarket] = useState(preferences.market);
  const [output, setOutput] = useState(preferences.output_locale || preferences.locale);
  function changeMarket(value: Market) { setMarket(value); setLocale(localeForMarket[value]); setOutput(localeForMarket[value]); }
  return <section className={styles.panel} aria-labelledby="language-heading">
    <div className={styles.sectionHeading}><h2 id="language-heading">{ui("界面语言与创作风格")}</h2></div>
    <p>{ui("切换地区会采用当地默认语言，之后可分别调整界面和输出语言。新作品采用此偏好，已有作品保留原设置。")}</p>
    <div className="locale-settings-grid"><label>{ui("创作地区风格")}<select value={market} onChange={e => changeMarket(e.target.value as Market)}>{markets.map(value => <option key={value} value={value}>{ui(marketLabels[value])}</option>)}</select></label><label>{ui("界面语言")}<select value={locale} onChange={e => setLocale(e.target.value as Locale)}>{locales.map(value => <option key={value} value={value}>{ui(languageLabels[value])}</option>)}</select></label><label>{ui("新作品输出语言")}<select value={output} onChange={e => setOutput(e.target.value as Locale)}>{locales.map(value => <option key={value} value={value}>{ui(languageLabels[value])}</option>)}</select></label></div>
    <div className="locale-settings-actions"><button className={styles.primary} onClick={() => save({ locale, market, output_locale: output })}>{ui("保存偏好")}</button><button className={styles.textButton} onClick={() => save()}>{ui("恢复地区自动选择")}</button></div>
  </section>;
}
export function LanguageSwitcher() {
  const ui = useUI();
  const preferences = usePreferences();
  const { locale } = preferences;
  return <select className="language-switcher" aria-label={ui("界面语言")} value={locale} onChange={e => {
    const nextLocale = e.target.value as Locale;
    save({ ...preferences, locale: nextLocale, output_locale: preferences.output_locale || locale });
  }}>{locales.map(value => <option key={value} value={value}>{ui(languageLabels[value])}</option>)}</select>;
}
export function WorkLanguageSettings({ market, locale, disabled, onChange }: { market: Market; locale: Locale; disabled?: boolean; onChange: (value: { market: Market; output_locale: Locale }) => void }) {
  const ui = useUI();
  return <fieldset className="work-language-settings" disabled={disabled}><legend>{ui("创作地区风格")}</legend><div className="locale-settings-grid"><label>{ui("创作地区风格")}<select value={market} onChange={e => { const next = e.target.value as Market; onChange({ market: next, output_locale: localeForMarket[next] }); }}>{markets.map(value => <option key={value} value={value}>{ui(marketLabels[value])}</option>)}</select></label><label>{ui("输出语言")}<select value={locale} onChange={e => onChange({ market, output_locale: e.target.value as Locale })}>{locales.map(value => <option key={value} value={value}>{ui(languageLabels[value])}</option>)}</select></label></div><small>{ui("仅影响之后的生成，现有正文不会自动翻译。")}</small></fieldset>;
}
