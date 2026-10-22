export const asset = (name: string) => `/sites/storyplay/${name}`;

export const dramas = [
  { id: 1, title: "我成全儿媳丁克，她却后悔了", genre: "家庭", tag: "new" },
  { id: 2, title: "我本神明", genre: "玄幻", tag: "new" },
  { id: 3, title: "猫猫我啊，把偏执反派养成老公了", genre: "甜宠", tag: "new" },
  { id: 4, title: "千面赌王", genre: "都市", tag: "hot" },
  { id: 5, title: "皑如山上雪", genre: "古装", tag: "hot" },
  { id: 6, title: "玫瑰不低头", genre: "都市", tag: "new" },
  { id: 7, title: "王牌保镖，从营救女友开始", genre: "都市", tag: "new" },
  { id: 8, title: "从流水线到清北", genre: "甜宠", tag: "new" },
  { id: 9, title: "五十岁隐藏身份，我遇见真爱", genre: "家庭", tag: "hot" },
  { id: 10, title: "爱是人间四月天", genre: "家庭", tag: "hot" },
];
// Titles were transcribed from the downloaded public posters. Genre filters
// are local preview metadata, not source categories or rankings.
export type CreationMode = "新建剧本" | "小说改编" | "剧本改写" | "灵感策划";
export type EditorTab = "故事设定" | "人物小传" | "分集大纲" | "剧本正文";
export type Project = {
  id: string;
  title: string;
  genre: string;
  audience: string;
  episodes: string;
  premise: string;
  mode: CreationMode;
  updatedAt: string;
  characters: string;
  outline: string;
  body: string;
};
export const STORAGE_KEY = "storyplay-local-projects-v1";
const modes: CreationMode[] = ["新建剧本", "小说改编", "剧本改写", "灵感策划"];
export function parseProjects(raw: string | null): Project[] {
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Invalid project collection");
  return data.filter((item): item is Project => {
    if (typeof item !== "object" || item === null) return false;
    const obj = item as Record<string, unknown>;
    return ["id", "title", "genre", "audience", "episodes", "premise", "updatedAt", "characters", "outline", "body"].every(key => typeof obj[key] === "string") && modes.includes(obj.mode as CreationMode);
  });
}
