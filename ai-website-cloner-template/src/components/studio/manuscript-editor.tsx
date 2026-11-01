"use client";
import { useUI } from "@/lib/i18n/provider";


import { FileText, Plus, Sparkles } from "lucide-react";
import type { Chapter, ContentType } from "@/lib/studio/api";
import { nextOutlineNumber } from "@/lib/studio/outline";
import styles from "./step-editors.module.css";

export function createManuscriptUnit(chapters: Chapter[], units: number, number: number, type: ContentType, label: (value: string) => string = value => value): { chapters: Chapter[]; number: number } | null {
  const next = Number.isInteger(number) && number >= 1 && number <= units && !chapters.some(chapter => chapter.number === number)
    ? number : nextOutlineNumber(chapters, units);
  if (next === null || !Number.isInteger(units) || units < 1 || units > 200) return null;
  return { chapters: [...chapters, { number: next, title: label(`第${next}${type === "novel" ? "章" : "集"}`), content: "" }], number: next };
}

export function patchManuscriptUnit(chapters: Chapter[], number: number, patch: Partial<Pick<Chapter, "title" | "content">>): Chapter[] {
  const index = chapters.findIndex(chapter => chapter.number === number);
  return chapters.map((chapter, i) => i === index ? { ...chapter, ...patch } : chapter);
}

export function ManuscriptEditor({ type, chapters, units, number, disabled = false, onNumber, onChange, onGenerate, onContinue, generating = false }: {
  type: ContentType; chapters: Chapter[]; units: number; number: number; disabled?: boolean;
  onNumber: (number: number) => void; onChange: (chapters: Chapter[]) => void;
  onGenerate?: () => void; onContinue?: () => void; generating?: boolean;
}) {
  const ui = useUI();
  const unit = type === "novel" ? "章" : "集";
  const chapter = chapters.find(item => item.number === number);
  const canGenerate = Number.isInteger(number) && number >= 1 && number <= units;
  const canCreate = nextOutlineNumber(chapters, units) !== null;
  function add() {
    if (disabled || generating) return;
    const result = createManuscriptUnit(chapters, units, number, type, ui);
    if (result) { onChange(result.chapters); onNumber(result.number); }
  }
  function patch(value: Partial<Pick<Chapter, "title" | "content">>) {
    if (!disabled && !generating) onChange(patchManuscriptUnit(chapters, number, value));
  }
  const empty = <section className={styles.emptyManuscript}><FileText size={65} strokeWidth={1.15} /><p>{ui(chapters.length ? `第${number}${unit}尚未创建` : `点击按钮创建新${unit}，AI辅助您生成初稿`)}</p><button type="button" className={styles.whiteButton} disabled={disabled || generating || !canCreate} onClick={add}>{ui(`创建新${unit}`)}</button>{!canCreate && <small>{ui("计划内的")}{ui(unit)}{ui("已全部创建")}</small>}</section>;
  return <div className={styles.editor}>{!chapters.length ? empty : <div className={styles.manuscriptLayout}>
    {chapter ? <section className={styles.manuscript} aria-label={ui(`第${number}${unit}正文编辑`)}>
      <div className={styles.manuscriptHeading}><input aria-label={ui(`第${number}${unit}标题`)} disabled={disabled || generating} maxLength={80} value={chapter.title} placeholder={ui(`第${number}${unit}标题`)} onChange={event => patch({ title: event.target.value })} /><div className={styles.manuscriptActions}>{onGenerate && <button type="button" className={styles.primary} disabled={disabled || generating || !canGenerate} onClick={onGenerate}><Sparkles size={17} />{ui(generating ? "生成中…" : `AI生成本${unit}`)}</button>}{onContinue && <button type="button" disabled={disabled || generating || !canGenerate || !chapter.content.trim()} onClick={onContinue}>{ui(`续写本${unit}`)}</button>}</div></div>
      {number > units && <p className={styles.hint}>{ui("此")}{ui(unit)}{ui("超出当前计划，原有内容已保留。")}</p>}
      <textarea dir="auto" aria-label={ui(type === "novel" ? "小说正文" : "剧本正文")} disabled={disabled || generating} value={chapter.content} maxLength={150000} onChange={event => patch({ content: event.target.value })} placeholder={ui(type === "novel" ? "从一个动作、一句对话，或一个无法回头的决定开始……" : "场1 地点 日 内\n出场人物：\n\n写下人物的行动与对白……")} />
      <div className={styles.manuscriptFooter}><span>{ui(Array.from(chapter.content).length.toLocaleString())} {ui(" 字")}</span><span>{ui(`第${number}${unit}`)} {ui(" · 已创建 ")}{ui(chapters.length)}{ui(unit)}</span></div>
    </section> : empty}
    <nav className={styles.episodeRail} aria-label={ui("正文目录")}>{chapters.map((item, index) => <button type="button" key={`${item.number}:${index}`} className={item.number === number ? styles.selectedEpisode : ""} aria-pressed={item.number === number} onClick={() => onNumber(item.number)}><span>{ui(String(item.number).padStart(2, "0"))}</span><strong>{item.title || ui(`第${item.number}${unit}`)}{item.number > units && <small> {ui(" · 超出计划")}</small>}</strong></button>)}<button type="button" disabled={disabled || generating || !canCreate} onClick={add}><Plus size={18} />{ui(`创建新${unit}`)}</button></nav>
  </div>}</div>;
}
