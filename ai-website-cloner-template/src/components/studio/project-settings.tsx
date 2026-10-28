"use client";

import { Check, ChevronDown, Mars, Venus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ContentType, WorkInput } from "@/lib/studio/api";
import { dramaGenres, novelGenres } from "@/lib/studio/writing";
import { WritingOptions } from "./writing-options";
import styles from "./project.module.css";

export type ProjectSettingsValue = Pick<WorkInput, "audience" | "genre" | "creative" | "premise" | "novel_settings" | "drama_settings" | "world_snapshot"> & { units: number | string; words_per_chapter: number | string };

const coreOptions = ["重生逆袭", "穿越", "先婚后爱", "双向救赎", "身份反转", "时间循环", "异能觉醒", "成长冒险"];
const styleOptions = ["轻松幽默", "情感细腻", "悬疑烧脑", "节奏紧凑", "温暖治愈", "热血", "现实质感", "浪漫"];
const anchors = ["目标受众", "题材类型", "核心设定", "风格元素", "世界观", "核心亮点", "核心梗概"];

export function ProjectSettings({ type, value, disabled = false, onChange, children }: {
  type: ContentType; value: ProjectSettingsValue; disabled?: boolean; onChange: (patch: Partial<ProjectSettingsValue>) => void; children?: ReactNode;
}) {
  const prefix = useId();
  const [activeAnchor, setActiveAnchor] = useState(0);
  const genres = type === "novel" ? novelGenres : dramaGenres;
  const creative = value.creative || {};
  function change(patch: Partial<ProjectSettingsValue>) { if (!disabled) onChange(patch); }
  function updateCreative(patch: NonNullable<WorkInput["creative"]>) { change({ creative: { ...creative, ...patch } }); }
  function editWorld(description: string) {
    change({ world_snapshot: { name: value.world_snapshot?.name || "作品专属世界", sections: value.world_snapshot?.sections || {}, ...value.world_snapshot, description } });
  }
  return <div className={styles.settingsLayout}>
    <section className={styles.settings} aria-label="故事设定"><h2>故事设定</h2>
      <div className={styles.settingGrid}>
        <div id={`${prefix}-setting-0`} className={styles.field}><span id={`${prefix}-audience`}>目标受众 <b>*</b></span><div className={styles.audience} role="group" aria-labelledby={`${prefix}-audience`}>
          <button type="button" disabled={disabled} aria-pressed={value.audience === "male"} className={`${styles.male} ${value.audience === "male" ? styles.chosen : ""}`} onClick={() => change({ audience: "male" })}><Mars size={20} />男频</button>
          <button type="button" disabled={disabled} aria-pressed={value.audience === "female"} className={`${styles.female} ${value.audience === "female" ? styles.chosen : ""}`} onClick={() => change({ audience: "female" })}><Venus size={20} />女频</button>
          <button type="button" disabled={disabled} aria-pressed={value.audience === "general"} className={`${styles.general} ${value.audience === "general" ? styles.chosen : ""}`} onClick={() => change({ audience: "general" })}>不限</button>
        </div></div>
        <div id={`${prefix}-setting-1`}><ProjectTagPicker label="题材类型" max={3} placeholder="选择或自定义输入背景" options={genres} value={creative.genres || []} disabled={disabled} onChange={tags => updateCreative({ genres: tags })} /></div>
        <div id={`${prefix}-setting-2`}><ProjectTagPicker label="核心设定" max={3} placeholder="选择或自定义输入类型" options={coreOptions} value={creative.core || []} disabled={disabled} onChange={tags => updateCreative({ core: tags })} /></div>
        <div id={`${prefix}-setting-3`}><ProjectTagPicker label="风格元素" max={5} placeholder="选择或自定义输入设定" options={styleOptions} value={creative.styles || []} disabled={disabled} onChange={tags => updateCreative({ styles: tags })} /></div>
        <label id={`${prefix}-setting-4`} className={`${styles.field} ${styles.fullWidth}`}>世界观（选填）<textarea rows={2} maxLength={5000} disabled={disabled} value={value.world_snapshot?.description || ""} onChange={event => editWorld(event.target.value)} placeholder="故事发生在怎样的世界？写下它的背景、规则与独特之处。" /></label>
        <label id={`${prefix}-setting-5`} className={`${styles.field} ${styles.fullWidth}`}>核心亮点（选填）<textarea rows={2} maxLength={5000} disabled={disabled} value={creative.highlights || ""} onChange={event => updateCreative({ highlights: event.target.value })} placeholder={type === "novel" ? "读者为什么会关心主角？主角将经历怎样的变化？" : "开场怎样抓住观众？每集靠什么冲突和反转推动？"} /></label>
        <label id={`${prefix}-setting-6`} className={`${styles.field} ${styles.fullWidth}`}><span>核心梗概 <b>*</b></span><textarea rows={5} maxLength={50000} disabled={disabled} value={value.premise} onChange={event => change({ premise: event.target.value })} placeholder="人物是谁？想要什么？会遇到怎样的冲突？" /></label>
      </div>
      <details className={styles.supplement}><summary>创作参数与作品世界</summary><div className={styles.supplementBody}>
        <WritingOptions kind={type} novel={value.novel_settings} drama={value.drama_settings} disabled={disabled} onChange={change} />
        <div className={styles.parameterGrid}>
          <label className={styles.field}>计划{type === "novel" ? "章节" : "集数"}<input name="units" type="number" min={1} max={200} required disabled={disabled} value={value.units} onChange={event => change({ units: event.target.value })} /></label>
          <label className={styles.field}>{type === "novel" ? "小说主分类" : "短剧题材"}<select name="genre" disabled={disabled} value={value.genre} onChange={event => change({ genre: event.target.value })}>{[...new Set([value.genre, ...genres])].map(genre => <option key={genre} value={genre}>{genre || "请选择"}</option>)}</select></label>
          <label className={styles.field}>{type === "novel" ? "每章目标字数" : "每集剧本字数"}<input name="words" type="number" min={300} max={type === "novel" ? 6000 : 3000} required disabled={disabled} value={value.words_per_chapter} onChange={event => change({ words_per_chapter: event.target.value })} /></label>
        </div>
        {children}
      </div></details>
    </section>
    <nav className={styles.settingRail} aria-label="故事设定目录">{anchors.map((name, index) => <button type="button" key={name} className={index === activeAnchor ? styles.currentAnchor : undefined} aria-current={index === activeAnchor ? "location" : undefined} onClick={() => { setActiveAnchor(index); document.getElementById(`${prefix}-setting-${index}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>{name}<i aria-hidden="true" /></button>)}</nav>
  </div>;
}

function ProjectTagPicker({ label, max, placeholder, options, value, disabled, onChange }: {
  label: string; max: number; placeholder: string; options: string[]; value: string[]; disabled: boolean; onChange: (value: string[]) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const expanded = open && !disabled;
  const choices = [...new Set([...options, ...(query.trim() ? [query] : [])])].filter(text => text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function select(text: string) {
    if (disabled) return;
    if (Array.from(text).length > 80) { setError("每项最多80字。"); return; }
    if (value.includes(text)) onChange(value.filter(item => item !== text));
    else if (value.length < max) onChange([...value, text]);
    else { setError(`最多选择${max}项，请先移除已有标签。`); return; }
    setError(""); setQuery(""); inputRef.current?.focus();
  }
  return <div className={styles.tagPicker} ref={ref} onKeyDown={event => { if (event.key === "Escape") { setOpen(false); inputRef.current?.focus(); } }}>
    <label className={styles.field} htmlFor={id}><span>{label} <b>*</b>（不超过{max}个）</span></label>
    <div className={styles.tagControl} onClick={() => { if (!disabled) { setOpen(true); inputRef.current?.focus(); } }}>
      <div className={styles.tagValues}>{value.map((text, index) => <span key={`${index}:${text}`} className={styles.tag}>{text}<button type="button" disabled={disabled} aria-label={`移除${label}：${text}`} onClick={event => { event.stopPropagation(); if (!disabled) onChange(value.filter((_, position) => position !== index)); }}><X size={12} /></button></span>)}
        <input id={id} ref={inputRef} maxLength={80} disabled={disabled} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-options`} aria-describedby={error ? `${id}-error` : undefined} value={query} placeholder={!value.length ? placeholder : ""} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); const target = query.trim() ? query : choices[0]; if (target) select(target); }
          if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()); }
        }} />
      </div><button type="button" disabled={disabled} aria-label={`${expanded ? "收起" : "展开"}${label}选项`} onClick={event => { event.stopPropagation(); if (!disabled) setOpen(!open); }}><ChevronDown size={20} /></button>
    </div>
    {error && <small id={`${id}-error`} className={styles.tagError} role="status">{error}</small>}
    {expanded && <div id={`${id}-options`} className={styles.tagOptions} role="listbox" aria-label={`${label}选项`} aria-multiselectable="true">{choices.map((text, index) => <button type="button" role="option" aria-selected={value.includes(text)} key={text} onClick={() => select(text)} onKeyDown={event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const items = ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]'); if (items?.length) items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
    }}><span>{options.includes(text) ? text : `添加“${text}”`}</span>{value.includes(text) && <Check size={15} />}</button>)}</div>}
  </div>;
}
