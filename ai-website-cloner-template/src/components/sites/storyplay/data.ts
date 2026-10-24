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
    return (
      [
        "id",
        "title",
        "genre",
        "audience",
        "episodes",
        "premise",
        "updatedAt",
        "characters",
        "outline",
        "body",
      ].every((key) => typeof obj[key] === "string") &&
      modes.includes(obj.mode as CreationMode)
    );
  });
}
