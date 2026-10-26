import type { WorkInput } from "@/lib/studio/api";

export type OfficialSample = {
  slug: string;
  logline: string;
  lessons: { title: string; text: string }[];
  work: WorkInput;
};

type Manuscript = Pick<WorkInput, "title" | "content_type" | "genre" | "premise" | "characters" | "outline" | "chapters"> & Partial<WorkInput>;

export function defineSample(info: Omit<OfficialSample, "work">, manuscript: Manuscript): OfficialSample {
  const novel = manuscript.content_type === "novel";
  return { ...info, work: {
    market: "china", output_locale: "zh-CN", mode: novel ? "小说创作" : "剧本创作",
    units: manuscript.chapters.length, words_per_chapter: novel ? 800 : 500,
    audience: "general", world_id: null, reference_ids: [],
    novel_settings: novel ? { form: "short_story", perspective: "third_limited", prose_style: "natural", pacing: "balanced" } : null,
    drama_settings: novel ? null : { format: "vertical_short", minutes_per_episode: 2, scene_density: "compact", hook_style: "reversal" },
    ...manuscript,
  } };
}
