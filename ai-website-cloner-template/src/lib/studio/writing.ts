import type { ContentType, NovelSettings, DramaSettings } from "./api";

export const defaultNovelSettings: NovelSettings = { form: "serial", perspective: "third_limited", prose_style: "natural", pacing: "balanced" };
export const defaultDramaSettings: DramaSettings = { format: "vertical_short", minutes_per_episode: 2, scene_density: "compact", hook_style: "reversal" };
export const novelGenres = ["都市日常", "现代言情", "古代言情", "悬疑推理", "东方玄幻", "武侠仙侠", "科幻末世", "历史架空", "青春校园", "现实文学", "其他"];
export const dramaGenres = ["都市", "甜宠", "悬疑", "古装", "家庭", "职场", "轻喜剧", "玄幻", "其他"];

export function creationMode(kind: ContentType, mode = "") {
  if (["灵感策划", "灵感创作"].includes(mode)) return "灵感创作";
  if (kind === "novel") return "小说创作";
  return ["小说改编", "剧本改写"].includes(mode) ? mode : "剧本创作";
}

export function creationDraftKeys(kind: ContentType, mode: string, referenceId = "original") {
  const modes = [mode];
  if (kind === "short_drama" && mode === "剧本创作") modes.push("新建剧本");
  if (mode === "灵感创作") modes.push("灵感策划");
  return modes.map(value => `plotloom-new-${kind}-${value}-${referenceId}`);
}
