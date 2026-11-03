import { currentSpaceId, type Work } from './api';
import type { GenerationJob } from './inline-generation';
export type FeedbackJob = GenerationJob & { completed: number; total: number; error?: string };
export type SubmissionPhase = '' | 'saving' | 'submitting' | 'opening';
const stages = ['premise', 'characters', 'outline', 'chapter'] as const;
export function generationFeedback(job: FeedbackJob) {
  const running = ['queued', 'running', 'stopping'].includes(job.status);
  const progress = Number.isFinite(job.total) && job.total > 0 && Number.isFinite(job.completed)
    ? Math.min(1, Math.max(0, job.completed / job.total)) : undefined;
  return { running, progress, stages: stages.map(action => ({ action,
    done: job.status === 'completed' || (action === 'chapter' ? job.completed >= job.total && job.total > 0 : !!job.results?.some(result => result.action === action && result.text.trim())),
    current: job.current.action === action,
  })) };
}
let handoff: { space: string; work: Work; job?: FeedbackJob; expires: number } | undefined;
export function rememberGeneration(work: Work, job?: FeedbackJob) {
  const space = currentSpaceId();
  if (space) handoff = { space, work, job, expires: Date.now() + 60_000 };
}
export function generationHandoff(id?: string) {
  if (!handoff) return undefined;
  if (handoff.space !== currentSpaceId() || handoff.expires < Date.now()) { handoff = undefined; return undefined; }
  return id === handoff.work.id ? handoff : undefined;
}
export function clearGenerationHandoff(id: string) { if (handoff?.work.id === id) handoff = undefined; }
