"use client";

import { Check, ChevronRight } from "lucide-react";
import { writingLabels, writingProgress, writingSteps } from "@/lib/studio/workflow";
import type { Action, ContentType, WorkInput } from "@/lib/studio/api";
import styles from "./workflow.module.css";

export function revealWritingStage() {
  requestAnimationFrame(() => document.getElementById("writing-stage-panel")?.scrollIntoView({ block: "start", behavior: "instant" }));
}

export function WorkflowNav({ type, current, value, disabled = false, onSelect }: {
  type: ContentType; current: Action;
  value: Pick<WorkInput, "premise" | "characters" | "outline" | "chapters" | "units">;
  disabled?: boolean; onSelect: (step: Action) => void;
}) {
  const labels = writingLabels(type);
  const progress = writingProgress(value);
  function select(step: Action) {
    onSelect(step);
    revealWritingStage();
  }
  return <div className={styles.navigation}>
    <div className={styles.caption}><strong>创作流程</strong><span>点击步骤切换 · 内容随时可修改</span></div>
    <div className={styles.steps} role="tablist" aria-label={type === "novel" ? "小说创作流程" : "剧本创作流程"}>
      {writingSteps.map((step, index) => <button type="button" role="tab" key={step} id={`writing-tab-${step}`} aria-controls="writing-stage-panel" aria-selected={current === step} tabIndex={current === step ? 0 : -1} disabled={disabled} className={current === step ? styles.selected : ""} onClick={() => select(step)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : -1;
        if (next < 0) return;
        event.preventDefault(); select(writingSteps[next]);
        document.getElementById(`writing-tab-${writingSteps[next]}`)?.focus();
      }}>
        <span className={`${styles.number} ${progress[step] ? styles.filled : ""}`}>{progress[step] ? <Check size={16} aria-label="已填写" /> : `0${index + 1}`}</span>
        <span className={styles.stepText}><strong>{labels[step]}</strong><small>{current === step ? "当前步骤" : step === "chapter" ? `${progress.completed}/${value.units}${type === "novel" ? "章" : "集"}` : progress[step] ? "已填写" : "未填写"}</small></span>
        {index < 3 && <ChevronRight className={styles.chevron} size={16} aria-hidden="true" />}
      </button>)}
    </div>
  </div>;
}
