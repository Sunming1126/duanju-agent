export type Person = { id: string; name: string; role: string; age: string; traits: string; background: string; relationships: string };
export type Episode = { id: string; title: string; text: string };
export type Outline = { id: string; phase: number; text: string };
export type PreviewDraft = {
  title: string; audience: string; genres: string[]; core: string[]; styles: string[];
  world: string; highlights: string; premise: string; characters: Person[];
  rough: string; outlines: Outline[]; episodes: Episode[]; words: number;
};

export function emptyDraft(): PreviewDraft {
  return { title: "剧本名称", audience: "", genres: [], core: [], styles: [], world: "", highlights: "", premise: "", characters: [], rough: "", outlines: [{ id: "first-outline", phase: 0, text: "" }], episodes: [], words: 800 };
}

export function readDraft(raw: string): PreviewDraft {
  const data = JSON.parse(raw) as { version?: number; draft?: PreviewDraft };
  const value = data.draft;
  if (data.version !== 1 || !value) throw new Error("草稿格式不兼容");
  for (const key of ["title", "audience", "world", "highlights", "premise", "rough"] as const) if (typeof value[key] !== "string") throw new Error("草稿不完整");
  for (const key of ["genres", "core", "styles"] as const) if (!Array.isArray(value[key]) || !value[key].every(x => typeof x === "string")) throw new Error("标签格式错误");
  if (!Array.isArray(value.characters) || !value.characters.every(person => person && ["id", "name", "role", "age", "traits", "background", "relationships"].every(key => typeof person[key as keyof Person] === "string"))) throw new Error("人物格式错误");
  if (!Array.isArray(value.episodes) || !value.episodes.every(episode => episode && ["id", "title", "text"].every(key => typeof episode[key as keyof Episode] === "string"))) throw new Error("正文格式错误");
  if (!Array.isArray(value.outlines) || !value.outlines.every(outline => outline && typeof outline.id === "string" && typeof outline.text === "string" && Number.isInteger(outline.phase) && outline.phase >= 0 && outline.phase <= 3)) throw new Error("大纲格式错误");
  if (!Number.isInteger(value.words) || value.words < 300 || value.words > 3000) throw new Error("字数格式错误");
  return value;
}

export function newPerson(): Person {
  return { id: crypto.randomUUID(), name: "", role: "", age: "", traits: "", background: "", relationships: "" };
}

export function escapeDocument(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
