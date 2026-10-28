import type { Work } from "./api";

export type CharacterJob = {
  id: string; mode: "single" | "all"; status: string; base_revision: number;
  current: { action: string; number: number };
  results?: { action: string; text: string; adopted: boolean }[];
};

/** API lists newest first. Never substitute an older success for a newer failure. */
export function latestCharacterJob<T extends CharacterJob>(jobs: T[]): T | undefined {
  return jobs.find(job => job.mode === "single" && job.current.action === "characters");
}

export function generatedCharacters(job?: CharacterJob): string | undefined {
  if (job?.mode !== "single" || job.status !== "completed" || job.results?.length !== 1) return;
  const result = job.results[0];
  if (result.action === "characters" && !result.adopted && result.text.trim()) return result.text;
}

export function canFillCharacterCards(job: CharacterJob | undefined, work: Pick<Work, "revision">, dirty: boolean): boolean {
  return !dirty && job?.base_revision === work.revision && generatedCharacters(job) !== undefined;
}
