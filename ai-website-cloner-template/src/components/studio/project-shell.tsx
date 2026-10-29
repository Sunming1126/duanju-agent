"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { ContentType, WorkInput } from "@/lib/studio/api";
import { editorLabels, editorSteps, writingProgress, type EditorStep } from "@/lib/studio/workflow";
import { revealWritingStage } from "./workflow-nav";
import styles from "./project.module.css";

export function ProjectShell({ children }: { children: ReactNode }) {
  return <div className={styles.project}>{children}</div>;
}

export function ProjectTitle({ type, title, disabled = false, onChange, actions }: {
  type: ContentType; title: string; disabled?: boolean; onChange: (title: string) => void; actions?: ReactNode;
}) {
  const label = type === "novel" ? "小说名称" : "剧本名称";
  return <header className={styles.header}>
    <span className={styles.titleMark} aria-hidden="true"><Sparkles size={20} /></span>
    <input aria-label={label} placeholder={label} value={title} maxLength={80} disabled={disabled} onChange={event => { if (!disabled) onChange(event.target.value); }} />
    <div className={styles.headerActions}>{actions}<Link className={styles.backLink} href="/workspace" aria-label="返回 Plotloom 作品库">Plotloom <span aria-hidden="true">↗</span></Link></div>
  </header>;
}

export function ProjectToolbar({ type, current, value, disabled = false, onSelect, actions }: {
  type: ContentType; current: EditorStep; value: Pick<WorkInput, "premise" | "characters" | "outline" | "chapters" | "units">;
  disabled?: boolean; onSelect: (step: EditorStep) => void; actions?: ReactNode;
}) {
  const progress = writingProgress(value);
  const labels = editorLabels(type);
  function revealTab(container: HTMLDivElement | null) {
    const active = container?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (container && active) {
      const bounds = container.getBoundingClientRect(), item = active.getBoundingClientRect();
      if (item.left < bounds.left) container.scrollLeft -= bounds.left - item.left;
      else if (item.right > bounds.right) container.scrollLeft += item.right - bounds.right;
    }
  }
  function select(step: EditorStep) { if (!disabled) { onSelect(step); revealWritingStage(); } }
  return <div className={styles.toolbar}>
    <div ref={revealTab} className={styles.tabs} role="tablist" aria-label={type === "novel" ? "小说创作流程" : "剧本创作流程"}>
      {editorSteps.map((step, index) => <button type="button" role="tab" key={step} id={`writing-tab-${step}`} aria-controls="writing-stage-panel" aria-selected={current === step} tabIndex={current === step ? 0 : -1} disabled={disabled} className={current === step ? styles.activeTab : undefined} onClick={() => select(step)} onKeyDown={event => {
        if (disabled) return;
        const count = editorSteps.length;
        const next = event.key === "ArrowRight" ? (index + 1) % count : event.key === "ArrowLeft" ? (index + count - 1) % count : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        select(editorSteps[next]);
        document.getElementById(`writing-tab-${editorSteps[next]}`)?.focus();
      }}><span>{labels[step]}</span><span className={styles.screenReaderOnly}>{current === step ? "当前步骤" : step === "settings" ? "创作参数和世界设定" : step === "chapter" ? `${progress.completed}/${value.units}${type === "novel" ? "章" : "集"}` : progress[step] ? "已填写" : "未填写"}</span></button>)}
    </div>
    {actions && <div className={styles.actions}>{actions}</div>}
  </div>;
}
