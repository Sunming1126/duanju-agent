export type ContentType = "short_drama" | "novel";
export type Section = {
  id: string;
  label: string;
  description: string;
  fields: { key: string; label: string }[];
};
export type StudioStatus = {
  llm_ready: boolean;
  model: string;
  world_sections: Section[];
};
export type WorldInput = {
  name: string;
  description: string;
  sections: Record<string, string>;
};
export type World = WorldInput & {
  id: string;
  revision: number;
  created_at: number;
  updated_at: number;
};
export type Chapter = { number: number; title: string; content: string };
export type WorkInput = {
  title: string;
  content_type: ContentType;
  genre: string;
  mode: string;
  units: number;
  premise: string;
  characters: string;
  outline: string;
  chapters: Chapter[];
  world_id: string | null;
  audience: "general" | "male" | "female";
  words_per_chapter: number;
  market: "china";
  output_locale: "zh-CN";
  legacy_id?: string | null;
  reference_ids: string[];
};
export type Work = WorkInput & {
  id: string;
  revision: number;
  created_at: number;
  updated_at: number;
};
export type Action = "premise" | "characters" | "outline" | "chapter";
export type Reference = {
  id: string;
  title: string;
  genre: string;
  source: string;
  source_url: string;
  logline: string;
  hook: string;
  beats: string[];
  content_type: ContentType;
};
export type Candidate = {
  id: string;
  work_id: string;
  action: Action;
  number: number;
  base_revision: number;
  status: "running" | "proposed" | "failed" | "adopted";
  text: string;
  error: string;
  world_revision?: number;
  references: Reference[];
  updated_at: number;
};
export type WorldPackage = {
  schema: "onesay.world-draft";
  version: 1;
  world: WorldInput;
  checksum: string;
};

export async function backendRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/backend${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Duanju-Site": "china",
        ...init.headers,
      },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    throw new Error(
      "无法连接本地后端，请先启动剧本平台服务；请求不会自动重试。",
    );
  }
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const detail =
      typeof data === "object" && data !== null ? data.detail : undefined;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((item: { msg?: string }) => item.msg || "参数无效")
              .join("；")
          : "本地服务请求失败，请确认后端已启动，并检查终端日志。";
    throw new Error(message);
  }
  return data as T;
}
export const jsonBody = (value: unknown) => JSON.stringify(value);
export function workPayload(work: Work): WorkInput {
  const {
    title,
    content_type,
    genre,
    mode,
    units,
    premise,
    characters,
    outline,
    chapters,
    world_id,
    audience,
    words_per_chapter,
    market,
    output_locale,
    legacy_id,
    reference_ids,
  } = work;
  return {
    title,
    content_type,
    genre,
    mode,
    units,
    premise,
    characters,
    outline,
    chapters,
    world_id,
    audience,
    words_per_chapter,
    market,
    output_locale,
    legacy_id,
    reference_ids,
  };
}
export function downloadText(
  name: string,
  text: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, "_");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function unitLabel(type: ContentType) {
  return type === "novel" ? "章" : "集";
}
export function localExport(work: Work) {
  const unit = unitLabel(work.content_type);
  return [
    work.title,
    `计划 ${work.units}${unit}`,
    `\n故事设定\n${work.premise}`,
    `\n人物\n${work.characters}`,
    `\n大纲\n${work.outline}`,
    ...work.chapters.map(
      (chapter) =>
        `\n第${chapter.number}${unit} ${chapter.title}\n${chapter.content}`,
    ),
  ].join("\n");
}
