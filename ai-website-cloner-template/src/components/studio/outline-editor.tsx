"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import type { ContentType } from "@/lib/studio/api";
import { nextOutlineNumber, parseOutline, serializeOutline, type OutlineDocument } from "@/lib/studio/outline";
import styles from "./step-editors.module.css";

export function OutlineEditor({ value, type, units, disabled = false, roughPreview, onChange }: {
  value: string; type: ContentType; units: number; disabled?: boolean; roughPreview?: string; onChange: (text: string) => void;
}) {
  const document = parseOutline(value);
  const [open, setOpen] = useState(true);
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState("");
  const roughId = useId();
  const unit = type === "novel" ? "章" : "集";
  function commit(next: OutlineDocument) {
    if (disabled) return;
    const text = next.structured ? serializeOutline(next) : next.rough;
    if (Array.from(text).length > 50000) { setError("大纲总长度不能超过50,000字，请精简后保存。"); return; }
    setError(""); onChange(text);
  }
  function add() {
    const number = nextOutlineNumber(document.entries, units);
    if (number === null) return;
    commit({ ...document, structured: true, entries: [...document.entries, { number, phase: 0, text: "" }] });
  }
  return <div className={styles.editor}>
    <div className={styles.viewToolbar}><button type="button" aria-pressed={raw} onClick={() => setRaw(!raw)}>切换{raw ? "分栏" : "全文"}编辑</button></div>
    {raw ? <label className={styles.raw}>大纲全文<textarea aria-label="大纲全文" disabled={disabled} value={value} rows={20} maxLength={50000} onChange={event => onChange(event.target.value)} /><small>全文包含全部粗纲与分{unit}内容，修改后保留原文。</small></label> :
      <section className={styles.outlineContent} aria-label="大纲编辑">
        <div className={styles.rough}><button type="button" className={styles.sectionTitle} aria-expanded={open} aria-controls={roughId} onClick={() => setOpen(!open)}><span>粗纲{roughPreview !== undefined && <small role="status"> · 生成中</small>}</span>{open ? <ChevronUp size={19} /> : <ChevronDown size={19} />}</button>{open && <div id={roughId}><textarea aria-label="粗纲" placeholder="写下故事的整体走向……" disabled={disabled || roughPreview !== undefined} value={roughPreview ?? document.rough} onChange={event => commit({ ...document, rough: event.target.value })} />{!document.structured && value && <small className={styles.hint}>原有大纲完整保留在此，可直接编辑，也可逐{unit}补充分纲。</small>}</div>}</div>
        <div className={styles.episodeHeading}><h3>{unit}纲</h3><span>{document.entries.length} / {units}{unit}</span></div>
        {document.entries.map(entry => <label key={entry.number} className={styles.episodeOutline}><span>第{entry.number}{unit}{entry.number > units && <small> · 超出当前计划，内容已保留</small>}</span><textarea aria-label={`第${entry.number}${unit}${unit}纲`} disabled={disabled} value={entry.text} onChange={event => commit({ ...document, entries: document.entries.map(item => item.number === entry.number ? { ...item, text: event.target.value } : item) })} /></label>)}
        <button type="button" className={styles.addOutline} disabled={disabled || nextOutlineNumber(document.entries, units) === null} onClick={add}><Plus size={17} />添加一{unit}</button>
      </section>
    }
    {error && <p className="studio-error" role="alert">{error}</p>}
  </div>;
}
