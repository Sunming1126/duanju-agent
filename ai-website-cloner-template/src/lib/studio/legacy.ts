import type { WorkInput } from "./api";

/** Explicit import only. Never delete, auto-clear or auto-replace browser drafts. */
export function legacyWorks(raw: string | null): WorkInput[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value))
    throw new Error("旧草稿不是有效的列表，原数据未改动。");
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object")
      throw new Error("旧草稿含不完整记录，已停止导入，原数据未改动。");
    const record = item as Record<string, unknown>;
    if (
      ![
        "id",
        "title",
        "genre",
        "premise",
        "characters",
        "outline",
        "body",
        "episodes",
      ].every((key) => typeof record[key] === "string")
    )
      throw new Error("旧草稿字段不完整，已停止导入，原数据未改动。");
    const units = Number(record.episodes);
    if (!record.title || !Number.isInteger(units) || units < 1 || units > 200)
      throw new Error("旧草稿的名称或数量无效，原数据未改动。");
    return {
      title: record.title as string,
      genre: record.genre as string,
      content_type: "short_drama",
      mode: typeof record.mode === "string" ? record.mode : "导入旧稿",
      units,
      premise: record.premise as string,
      characters: record.characters as string,
      outline: record.outline as string,
      chapters: record.body
        ? [{ number: 1, title: "第1集", content: record.body as string }]
        : [],
      world_id: null,
      audience: "general",
      words_per_chapter: 1000,
      market: "china",
      output_locale: "zh-CN",
      legacy_id: `browser-v1:${record.id}`,
      reference_ids: [],
    };
  });
}
