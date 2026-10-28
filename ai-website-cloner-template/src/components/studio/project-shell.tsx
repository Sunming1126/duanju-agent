"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { Action, ContentType, WorkInput } from "@/lib/studio/api";
import { writingProgress, writingSteps } from "@/lib/studio/workflow";
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
  type: ContentType; current: Action; value: Pick<WorkInput, "premise" | "characters" | "outline" | "chapters" | "units">;
  disabled?: boolean; onSelect: (step: Action) => void; actions?: ReactNode;
}) {
  const progress = writingProgress(value);
  const labels: Record<Action, string> = type === "novel"
    ? { premise: "故事梗概", characters: "人物档案", outline: "章节大纲", chapter: "小说正文" }
    : { premise: "故事梗概", characters: "人物小传", outline: "分集大纲", chapter: "剧本正文" };
  return <div className={styles.toolbar}>
    <div className={styles.tabs} role="tablist" aria-label={type === "novel" ? "小说创作流程" : "剧本创作流程"}>
      {writingSteps.map((step, index) => <button type="button" role="tab" key={step} id={`writing-tab-${step}`} aria-controls="writing-stage-panel" aria-selected={current === step} tabIndex={current === step ? 0 : -1} disabled={disabled} className={current === step ? styles.activeTab : undefined} onClick={() => { if (!disabled) onSelect(step); }} onKeyDown={event => {
        if (disabled) return;
        const next = event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : -1;
        if (next < 0) return;
        event.preventDefault();
        onSelect(writingSteps[next]);
        document.getElementById(`writing-tab-${writingSteps[next]}`)?.focus();
      }}><span>{labels[step]}</span><span className={styles.screenReaderOnly}>{current === step ? "当前步骤" : step === "chapter" ? `${progress.completed}/${value.units}${type === "novel" ? "章" : "集"}` : progress[step] ? "已填写" : "未填写"}</span></button>)}
    </div>
    {actions && <div className={styles.actions}>{actions}</div>}
  </div>;
}
