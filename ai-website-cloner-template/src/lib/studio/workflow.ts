import type { Action, ContentType, WorkInput } from "./api";

export const writingSteps: Action[] = ["premise", "characters", "outline", "chapter"];
export type CreationIntent = { step: Action; number: number; generate: boolean };

export function writingLabels(type: ContentType): Record<Action, string> {
  return type === "novel"
    ? { premise: "小说设定", characters: "人物档案", outline: "章节大纲", chapter: "小说正文" }
    : { premise: "剧本设定", characters: "人物小传", outline: "分集大纲", chapter: "分场剧本" };
}

export function writingProgress(value: Pick<WorkInput, "premise" | "characters" | "outline" | "chapters" | "units">) {
  const completed = new Set(value.chapters.filter(c => Number.isInteger(c.number) && c.number >= 1 && c.number <= value.units && c.content.trim()).map(c => c.number)).size;
  return {
    premise: !!value.premise.trim(), characters: !!value.characters.trim(), outline: !!value.outline.trim(),
    chapter: completed >= value.units && value.units > 0, completed,
  };
}

/** Query values select a view only; they never start a model request. */
export function writingDestination(search: string): { step: Action; number: number } {
  const params = new URLSearchParams(search);
  const step = params.get("step") as Action;
  const number = Number(params.get("number"));
  return { step: writingSteps.includes(step) ? step : "premise", number: Number.isInteger(number) && number >= 1 && number <= 200 ? number : 1 };
}

export function workEditorUrl(id: string, intent: Pick<CreationIntent, "step" | "number">) {
  return `/studio/works/${encodeURIComponent(id)}?step=${intent.step}&number=${intent.number}`;
}
