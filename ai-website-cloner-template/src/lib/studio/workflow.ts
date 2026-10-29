import type { Action, ContentType, WorkInput } from "./api";

export const writingSteps: Action[] = ["premise", "characters", "outline", "chapter"];
export type EditorStep = Action | "settings";
export const editorSteps: EditorStep[] = ["premise", "settings", "characters", "outline", "chapter"];
export type CreationIntent = { step: EditorStep; number: number; generate: boolean; all?: boolean };

export function editorLabels(type: ContentType): Record<EditorStep, string> {
  return { ...writingLabels(type), premise: "故事梗概", settings: "参数与世界", chapter: type === "novel" ? "小说正文" : "剧本正文" };
}

export function nextEditorStep(step: EditorStep): EditorStep | undefined {
  return editorSteps[editorSteps.indexOf(step) + 1];
}

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
export function writingDestination(search: string): { step: EditorStep; number: number } {
  const params = new URLSearchParams(search);
  const step = params.get("step") as EditorStep;
  const number = Number(params.get("number"));
  return { step: editorSteps.includes(step) ? step : "premise", number: Number.isInteger(number) && number >= 1 && number <= 200 ? number : 1 };
}

export function workEditorUrl(id: string, intent: Pick<CreationIntent, "step" | "number">) {
  return `/studio/works/${encodeURIComponent(id)}?step=${intent.step}&number=${intent.number}`;
}
