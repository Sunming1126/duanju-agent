"use client";
import { useEffect, useState, type ReactNode } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { useUI } from '@/lib/i18n/provider';
import { generationFeedback, type FeedbackJob, type SubmissionPhase } from '@/lib/studio/generation-feedback';
import styles from './generation-feedback.module.css';
export function LoadingIcon() { return <LoaderCircle size={17} className={styles.spinner} aria-hidden="true" />; }
export function SubmissionLabel({ phase }: { phase: SubmissionPhase }) {
  const ui = useUI();
  return phase ? <><LoadingIcon />{ui(phase === 'saving' ? '正在保存…' : phase === 'submitting' ? '正在提交…' : '正在打开…')}</> : null;
}
export function EditorSkeleton() {
  const ui = useUI();
  return <div className={styles.skeleton} aria-busy="true"><p role="status"><LoadingIcon />{ui('正在打开创作空间…')}</p><div /><div /><div /></div>;
}
export function GenerationProgress({ job, conflict = false, children, unit = "章" }: { job: FeedbackJob; conflict?: boolean; children?: ReactNode; unit?: string }) {
  const ui = useUI();
  const state = generationFeedback(job);
  const [hidden, setHidden] = useState('');
  useEffect(() => {
    if (job.status !== 'completed' || conflict) return;
    const timer = setTimeout(() => setHidden(job.id), 3200);
    return () => clearTimeout(timer);
  }, [job.id, job.status, conflict]);
  if (hidden === job.id && job.status === 'completed' && !conflict) return null;
  const labels = { premise: '故事梗概', characters: '人物', outline: '大纲', chapter: '正文' };
  const status = job.status === 'completed' ? '生成完成' : job.status === 'queued' ? '排队中' : job.status === 'stopping' ? '正在停止' : job.status === 'running' ? '生成中' : job.status === 'failed' ? '失败' : '已停止';
  return <section className={styles.panel} aria-label={ui('生成进度')}>
    <div className={styles.heading}><span role="status" aria-live="polite" key={`${job.current.action}:${job.current.number}:${job.status}`} className={styles.caption}>{state.running ? <LoadingIcon /> : job.status === 'completed' ? <Check size={17} /> : null}{ui(status)} · {ui(labels[job.current.action as keyof typeof labels] || '作品世界')}{job.current.action === 'chapter' && <> · {ui(`第${job.current.number}${unit}`)}</>}</span><span className={styles.count}>{Number.isFinite(job.total) && job.total > 0 ? `${job.completed}/${job.total}` : ''}</span></div>
    {job.mode === 'all' && <ol className={styles.stages}>{state.stages.map(stage => <li key={stage.action} data-current={stage.current && job.status === "running"} data-done={stage.done}>{stage.done ? <Check size={13} /> : stage.current && state.running ? <LoadingIcon /> : <i />}{ui(labels[stage.action])}</li>)}</ol>}
    <div className={styles.track} role="progressbar" aria-label={ui('生成进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress === undefined ? undefined : Math.round(state.progress * 100)}><span className={state.progress === undefined && state.running ? styles.indeterminate : undefined} style={{ transform: `scaleX(${state.progress ?? (state.running ? .25 : 0)})` }} /></div>
    {job.error && <p>{ui(job.error, true)}</p>}
    {children && <div className={styles.actions}>{children}</div>}
  </section>;
}
