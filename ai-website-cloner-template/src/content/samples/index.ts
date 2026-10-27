import type { ContentType, WorkInput } from "@/lib/studio/api";
import { lastLight } from "./last-light";
import { platformSeven } from "./platform-seven";
import { receipt } from "./receipt";
import { rainCheck } from "./rain-check";
import type { OfficialSample } from "./schema";
import { gateName } from "./gate-name";
import { doorCard } from "./door-card";
import { temporaryParent } from "./temporary-parent";
import { grainScale } from "./grain-scale";
import { banquetPayroll } from "./banquet-payroll";
import { nightWatch } from "./night-watch";
import { shopSign } from "./shop-sign";
import { immortalDebt } from "./immortal-debt";
import { extraSeat } from "./extra-seat";
import { floorThirteen } from "./floor-thirteen";

export type { OfficialSample } from "./schema";
export const officialSamples: readonly OfficialSample[] = [gateName, doorCard, temporaryParent, grainScale, banquetPayroll, nightWatch, shopSign, immortalDebt, extraSeat, floorThirteen];
// Preserve already-shared URLs without showing the previous batch in the list.
export const archivedSamples: readonly OfficialSample[] = [lastLight, receipt, platformSeven, rainCheck];

export function getOfficialSample(slug: string, kind?: ContentType) {
  return [...officialSamples, ...archivedSamples].find(sample => sample.slug === slug && (!kind || sample.work.content_type === kind));
}

export function sampleCreationInput(sample: OfficialSample): WorkInput {
  const work = sample.work;
  return {
    title: `${work.title} · 我的版本`, content_type: work.content_type, mode: work.mode, genre: work.genre,
    units: work.units, words_per_chapter: work.words_per_chapter, audience: work.audience,
    premise: work.premise, creative: structuredClone(work.creative), world_snapshot: structuredClone(work.world_snapshot),
    novel_settings: structuredClone(work.novel_settings), drama_settings: structuredClone(work.drama_settings),
    characters: "", outline: "", chapters: [], reference_ids: [], world_id: null, market: "china", output_locale: "zh-CN",
  };
}

export function sampleCreationHref(sample: OfficialSample) {
  return `/studio/${sample.work.content_type === "novel" ? "novels" : "scripts"}/new?sample=${sample.slug}`;
}

export function sampleCharacterCount(sample: OfficialSample) {
  return sample.work.chapters.reduce((count, chapter) => count + chapter.content.replace(/\s/g, "").length, 0);
}

export const worldLabels: Record<string, string> = { world_rules: "世界规则", locations: "主要地点", relations: "人物关系" };

export function sampleDocument(sample: OfficialSample) {
  const work = sample.work;
  const novel = work.content_type === "novel";
  const perspective = { first_person: "第一人称", third_limited: "第三人称有限视角", omniscient: "全知视角", multiple: "多视角" };
  const settings = novel
    ? `短篇小说 · ${perspective[work.novel_settings!.perspective]}`
    : `${work.drama_settings!.format === "vertical_short" ? "竖屏" : "横屏"}短剧 · 单集目标${work.drama_settings!.minutes_per_episode}分钟（示范参数）`;
  return [
    `《${work.title}》`, "Plotloom 官方样例 · AI辅助创作", "原创教学示范，可作为学习和创作练习参考。", "",
    `${novel ? "小说" : "剧本"} / ${work.genre} / ${work.units}${novel ? "章" : "集"}`, settings, sample.logline,
    ...(sample.reference ? ["", `题材参考：${sample.reference.date} 红果热播总榜第${sample.reference.rank}名《${sample.reference.title}》`,
      `参考方向：${sample.reference.direction}`, `榜单来源：${sample.reference.url}`, "人物、事件与结局为本示范独立创作。"] : []),
    "", "一、故事设定", work.premise, "", "核心设定", work.creative?.core?.join("、") || "",
    "", "亮点", work.creative?.highlights || "", "", "世界观", work.world_snapshot?.description || "",
    ...Object.entries(work.world_snapshot?.sections || {}).map(([key, value]) => `${worldLabels[key] || key}\n${value}`),
    "", "二、人物", work.characters, "", novel ? "三、章节大纲" : "三、分集大纲", work.outline,
    "", novel ? "四、小说正文" : "四、分场剧本",
    ...work.chapters.flatMap(chapter => ["", `第${chapter.number}${novel ? "章" : "集"} ${chapter.title}`, "", chapter.content]),
    "", "五、阅读提示", ...sample.lessons.map(lesson => `${lesson.title}\n${lesson.text}`), "", "更多样例：https://jubencn.onesay.top/samples", "",
  ].join("\n");
}
