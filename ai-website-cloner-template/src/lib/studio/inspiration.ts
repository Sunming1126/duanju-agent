import type { Action, Chapter, ContentType, Reference, WorkInput, WorldInput, NovelSettings, DramaSettings } from "./api";
import { creationMode, defaultNovelSettings, defaultDramaSettings } from "./writing";

export type InspirationPlan = { id: string; title: string; summary: string; story: string };
export type InspirationSession = {
  id: string;
  revision: number;
  input: { content_type: ContentType; prompt: string; audience: WorkInput["audience"]; genres: string; core: string; styles: string };
  plans: InspirationPlan[];
  analysis: WorkInput | null;
  analyzed_plan_id: string | null;
  job: { id: string; action: "generate" | "revise" | "analyze"; status: string; error: string };
};

/** Only the latest completed analysis is eligible for the dedicated result view. */
export function showInspirationAnalysis(session: InspirationSession | undefined, dismissedJobId: string | null, submittingAnalysis: boolean): boolean {
  return !!session?.analysis && session.job.action === "analyze" && session.job.status === "completed"
    && session.job.id !== dismissedJobId && !submittingAnalysis;
}

/** A previous result remains available after a failed job only by explicit choice. */
export function showPreviousInspirationAnalysis(session: InspirationSession | undefined, requested: boolean, submittingAnalysis: boolean): boolean {
  return !!session?.analysis && requested && !submittingAnalysis && ["failed", "interrupted"].includes(session.job.status);
}

export type CreationDraft = {
  title: string;
  content_type: ContentType;
  genre: string;
  units: string;
  words: string;
  audience: WorkInput["audience"];
  genres: string;
  core: string;
  styles: string;
  // Older browser drafts use comma-separated tags; analysis preserves each tag on its own line.
  tag_format?: "lines";
  tag_source?: { genres: string[]; core: string[]; styles: string[] };
  highlights: string;
  premise: string;
  characters: string;
  outline: string;
  chapters: Chapter[];
  step?: Action;
  chapter_number?: number;
  source_text: string;
  world_id: string;
  world_snapshot: WorldInput | null;
  novel_settings: NovelSettings | null;
  drama_settings: DramaSettings | null;
};

export function initialCreationDraft(type: ContentType, reference?: Reference): CreationDraft {
  return {
    title: "", content_type: type, genre: reference?.genre || (type === "novel" ? "都市日常" : "都市"), units: "12",
    words: type === "novel" ? "2000" : "800", audience: "general", genres: "", core: "", styles: "",
    highlights: "", premise: reference ? `参考素材：${reference.title}\n${reference.logline}\n${reference.hook}\n\n我的创作方向：` : "", source_text: "",
    characters: "", outline: "", chapters: [],
    world_id: "", world_snapshot: null,
    novel_settings: type === "novel" ? { ...defaultNovelSettings } : null,
    drama_settings: type === "short_drama" ? { ...defaultDramaSettings } : null,
  };
}

/** Analysis fills editable fields only. It never creates a work or starts generation. */
export function applyInspiration(draft: CreationDraft, analysis: WorkInput): CreationDraft {
  if (analysis.content_type !== draft.content_type) throw new Error("方案类型与当前创作类型不一致，请切换到对应入口。");
  return {
    ...draft, title: analysis.title, genre: analysis.genre, units: String(analysis.units), words: String(analysis.words_per_chapter),
    audience: analysis.audience, premise: analysis.premise, source_text: draft.source_text || draft.premise, genres: (analysis.creative?.genres || []).join("\n"),
    core: (analysis.creative?.core || []).join("\n"), styles: (analysis.creative?.styles || []).join("\n"), tag_format: "lines",
    tag_source: { genres: [...(analysis.creative?.genres || [])], core: [...(analysis.creative?.core || [])], styles: [...(analysis.creative?.styles || [])] },
    highlights: analysis.creative?.highlights || "", world_id: "", world_snapshot: analysis.world_snapshot || null,
    novel_settings: draft.content_type === "novel" ? analysis.novel_settings || draft.novel_settings || { ...defaultNovelSettings } : null,
    drama_settings: draft.content_type === "short_drama" ? analysis.drama_settings || draft.drama_settings || { ...defaultDramaSettings } : null,
  };
}

export function creationPayload(draft: CreationDraft, mode: string, generate: boolean, reference?: Reference, expectedType = draft.content_type): WorkInput {
  const tags = (value: string, max: number, label: string, field: "genres" | "core" | "styles") => {
    const separator = draft.tag_format === "lines" ? /\r?\n/ : /[,，、\n]/;
    const source = draft.tag_source?.[field];
    if (draft.tag_format === "lines" && Array.isArray(source) && source.some(s => typeof s === "string" && /[\r\n]/.test(s)) && source.join("\n") !== value) {
      throw new Error(`${label}的原始项目含有换行，请将每项整理为一行，并确认标签分隔后再提交。`);
    }
    // Preserve even unusual newlines inside an untouched analysis item.
    const values = draft.tag_format === "lines" && Array.isArray(source) && source.every(s => typeof s === "string") && source.join("\n") === value
      ? source : value.split(separator);
    const list = [...new Set(values.map(s => s.trim()).filter(Boolean))];
    if (list.length > max || list.some(s => Array.from(s).length > 80)) {
      const hint = draft.tag_format === "lines" ? "每行填写一项。" : "请用逗号分隔，或重新回填灵感方案。";
      throw new Error(`${label}最多${max}项，每项不超过80字。${hint}`);
    }
    return list;
  };
  if (draft.content_type !== expectedType) throw new Error("草稿类型与当前入口不一致，请从对应入口创建作品。");
  if (!draft.title.trim()) throw new Error("请填写作品名称。");
  if (generate && !draft.premise.trim()) throw new Error("请先填写故事想法，或选择仅创建草稿。");
  const units = Number(draft.units), words = Number(draft.words);
  if (!Number.isInteger(units) || units < 1 || units > 200) throw new Error("计划集／章数须为1至200的整数。");
  const maxWords = expectedType === "novel" ? 6000 : 3000;
  if (!Number.isInteger(words) || words < 300 || words > maxWords) throw new Error(`每集／章字数须为300至${maxWords}的整数。`);
  const chapters = draft.chapters || [];
  if (chapters.some(c => !Number.isInteger(c.number) || c.number < 1 || c.number > units) || new Set(chapters.map(c => c.number)).size !== chapters.length) throw new Error("计划集／章数不能小于已填写正文的最大编号，且正文编号不能重复。");
  if ([draft.premise, draft.characters || "", draft.outline || ""].some(text => Array.from(text).length > 50000)) throw new Error("故事、人物或大纲不能超过50,000字。");
  if (chapters.some(c => Array.from(c.content).length > 150000 || Array.from(c.title).length > 80)) throw new Error("正文不能超过150,000字，章节标题不能超过80字。");
  if (reference && reference.content_type !== draft.content_type) throw new Error("参考素材类型与作品不一致。");
  return {
    title: draft.title.trim(), content_type: draft.content_type, genre: draft.genre.trim() || "其他",
    mode: creationMode(expectedType, mode),
    novel_settings: expectedType === "novel" ? draft.novel_settings || { ...defaultNovelSettings } : null,
    drama_settings: expectedType === "short_drama" ? draft.drama_settings || { ...defaultDramaSettings } : null,
    units, words_per_chapter: words, audience: draft.audience, premise: draft.premise.trim(), characters: draft.characters || "", outline: draft.outline || "", chapters: chapters.map(c => ({ ...c })),
    // An edited/generated snapshot is already an independent copy, never re-copy a library world over it.
    world_id: draft.world_snapshot ? null : draft.world_id || null, world_snapshot: draft.world_snapshot,
    market: "china", output_locale: "zh-CN", reference_ids: reference ? [reference.id] : [],
    creative: { genres: tags(draft.genres || draft.genre, 3, "自定义题材", "genres"), core: tags(draft.core, 3, "核心设定", "core"), styles: tags(draft.styles, 5, "风格", "styles"),
      highlights: draft.highlights, source_text: ["小说改编", "剧本改写"].includes(mode) ? draft.source_text || draft.premise : "" },
  };
}
