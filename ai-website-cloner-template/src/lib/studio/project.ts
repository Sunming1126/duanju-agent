import type { CreationDraft } from "./inspiration";
import type { Work, WorkInput } from "./api";

type Tags = NonNullable<WorkInput["creative"]>;
export type ProjectSettingsValue = Pick<WorkInput, "audience" | "genre" | "creative" | "premise" | "novel_settings" | "drama_settings" | "world_snapshot"> & { units: number | string; words_per_chapter: number | string };
const fields = ["genres", "core", "styles"] as const;
function draftTags(draft: CreationDraft, key: typeof fields[number]) {
  const value = draft[key];
  const original = draft.tag_source?.[key];
  return draft.tag_format === "lines" && original?.join("\n") === value ? original : [...new Set(value.split(draft.tag_format === "lines" ? /\r?\n/ : /[,，、\n]/).map(s => s.trim()).filter(Boolean))];
}
export function projectSettingsFromDraft(draft: CreationDraft): ProjectSettingsValue {
  return { audience: draft.audience, genre: draft.genre, creative: { genres: draftTags(draft,"genres"), core: draftTags(draft,"core"), styles: draftTags(draft,"styles"), highlights: draft.highlights, source_text: draft.source_text }, premise: draft.premise, units: draft.units, words_per_chapter: draft.words, novel_settings: draft.novel_settings, drama_settings: draft.drama_settings, world_snapshot: draft.world_snapshot };
}
export function applyProjectSettings(draft: CreationDraft, patch: Partial<ProjectSettingsValue>): Partial<CreationDraft> {
  const result: Partial<CreationDraft> = {};
  for (const key of ["audience", "genre", "premise", "novel_settings", "drama_settings", "world_snapshot"] as const) if (key in patch) Object.assign(result, { [key]: patch[key] });
  if (patch.units !== undefined) result.units = String(patch.units);
  if (patch.words_per_chapter !== undefined) result.words = String(patch.words_per_chapter);
  if (patch.creative) {
    const old = projectSettingsFromDraft(draft).creative!;
    const source = { genres: draftTags(draft,"genres"), core: draftTags(draft,"core"), styles: draftTags(draft,"styles") };
    const retainedSource = { ...draft.tag_source };
    for (const field of fields) {
      const next = patch.creative[field];
      if (next && JSON.stringify(next) !== JSON.stringify(old[field])) { result[field] = next.join("\n"); retainedSource[field] = [...next]; }
      else if (draft.tag_format !== "lines") { result[field] = source[field].join("\n"); retainedSource[field] = source[field]; }
    }
    result.tag_format = "lines";
    result.tag_source = { genres: retainedSource.genres || source.genres, core: retainedSource.core || source.core, styles: retainedSource.styles || source.styles };
    if (patch.creative.highlights !== undefined) result.highlights = patch.creative.highlights;
  }
  return result;
}
export function settingsPatch(work: Work, analysis: WorkInput): Partial<Work> {
  if (analysis.content_type !== work.content_type) throw new Error("方案类型与作品不一致。");
  if (analysis.units < Math.max(1, ...work.chapters.map(c => c.number))) throw new Error("方案计划数量小于已有正文的最大编号，请先在灵感方案中调整数量。");
  return { title: analysis.title, audience: analysis.audience, genre: analysis.genre, creative: { ...analysis.creative, source_text: work.creative?.source_text || analysis.creative?.source_text || "" } as Tags, premise: analysis.premise, units: analysis.units, words_per_chapter: analysis.words_per_chapter, novel_settings: analysis.novel_settings, drama_settings: analysis.drama_settings, world_id: null, world_snapshot: analysis.world_snapshot };
}
export function projectNumbers(work: Pick<WorkInput,"content_type"|"units"|"words_per_chapter"|"chapters">, input: { units?: string; words_per_chapter?: string }) {
  const units = Number(input.units ?? work.units), words_per_chapter = Number(input.words_per_chapter ?? work.words_per_chapter);
  if (!Number.isInteger(units) || units < Math.max(1,...work.chapters.map(c=>c.number)) || units > 200) throw new Error("计划集／章数须为1至200的整数，且不能小于已有正文的最大编号。");
  const max = work.content_type === "novel" ? 6000 : 3000;
  if (!Number.isInteger(words_per_chapter) || words_per_chapter < 300 || words_per_chapter > max) throw new Error(`正文目标字数须为300至${max}的整数。`);
  return { units, words_per_chapter };
}
