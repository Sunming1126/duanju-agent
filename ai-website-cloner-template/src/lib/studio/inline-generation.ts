import type { Action, Work, WorldInput } from "./api";

export type GenerationResult = {
  action: Action | "world"; number: number; text: string; adopted: boolean; world?: WorldInput;
};
export type GenerationJob = {
  id: string; mode: "single" | "all"; status: string; base_revision: number; adoption_revision?: number;
  current: { action: string; number: number }; results?: GenerationResult[];
};
export const activeGeneration = ["queued", "running", "stopping"];

/** Newest-first API order: a failed latest request must not reveal an older success. */
export function latestGeneration<T extends GenerationJob>(jobs: T[], step: Action, number: number): T | undefined {
  return jobs.find(job => activeGeneration.includes(job.status)) || jobs.find(job =>
    job.mode === "all" || step === "premise" && job.current.action === "world" || job.current.action === step && (step !== "chapter" || job.current.number === number));
}

export function pendingResults(job?: GenerationJob): GenerationResult[] {
  return (job?.results || []).filter(result => !result.adopted && result.text.trim() &&
    ["premise", "characters", "outline", "chapter", "world"].includes(result.action) &&
    (result.action !== "chapter" || Number.isInteger(result.number) && result.number >= 1 && result.number <= 200) &&
    (result.action !== "world" || !!result.world));
}

export function generationSignature(job?: GenerationJob): string {
  const ready = new Set(pendingResults(job));
  return job ? `${job.id}:${(job.results || []).flatMap((result, index) => ready.has(result) ? [index] : []).join(",")}` : "";
}

export function canFillGeneration(job: GenerationJob | undefined, work: Pick<Work, "revision">, dirty: boolean): boolean {
  return !dirty && !!job && (job.adoption_revision ?? job.base_revision) === work.revision && pendingResults(job).length > 0;
}

/** Read-only conflict preview. Saving always uses the server's atomic revision check. */
export function previewGeneration(work: Work, result: GenerationResult): Work {
  if (result.action === "world") return { ...work, world_snapshot: result.world || work.world_snapshot };
  if (result.action !== "chapter") return { ...work, [result.action]: result.text };
  const existing = work.chapters.find(chapter => chapter.number === result.number);
  return { ...work, chapters: [...work.chapters.filter(chapter => chapter.number !== result.number), {
    number: result.number, title: existing?.title ?? `第${result.number}${work.content_type === "novel" ? "章" : "集"}`, content: result.text,
  }].sort((a, b) => a.number - b.number) };
}
