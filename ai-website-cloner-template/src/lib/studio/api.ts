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
  max_concurrent_requests?: number;
  isolated?: boolean;
};
export type WorldInput = {
  name: string;
  description: string;
  sections: Record<string, string>;
  archived?: boolean;
};
export type World = WorldInput & {
  id: string;
  revision: number;
  created_at: number;
  updated_at: number;
};
export type Chapter = { number: number; title: string; content: string };
export type NovelSettings = {
  form: "serial" | "short_story";
  perspective: "third_limited" | "first_person" | "omniscient" | "multiple";
  prose_style: "natural" | "immersive" | "literary" | "light";
  pacing: "balanced" | "fast" | "slow_burn";
};
export type DramaSettings = {
  format: "vertical_short" | "horizontal_short";
  minutes_per_episode: number;
  scene_density: "compact" | "balanced" | "multi_scene";
  hook_style: "reversal" | "suspense" | "emotional";
};
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
  novel_settings?: NovelSettings | null;
  drama_settings?: DramaSettings | null;
  market: "china";
  output_locale: "zh-CN";
  legacy_id?: string | null;
  reference_ids: string[];
  world_snapshot?: WorldInput | null;
  creative?: { genres?: string[]; core?: string[]; styles?: string[]; highlights?: string; source_text?: string };
  archived?: boolean;
};
export type Work = WorkInput & {
  id: string;
  revision: number;
  created_at: number;
  updated_at: number;
};
export type WorkSummary = Pick<Work, "id" | "title" | "content_type" | "genre" | "units" | "revision" | "created_at" | "updated_at"> & {
  archived: boolean;
  completed_units: number;
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

export type StudioSpace = { space_id: string; isolated: boolean; legacy_access: boolean };
let spaceRequest: Promise<StudioSpace> | undefined;
let spaceId: string | undefined;
export function currentSpaceId() { return spaceId; }
export function ensureStudioSpace(): Promise<StudioSpace> {
  if (!spaceRequest) {
    const establish = () => fetch("/api/backend/studio/session", {
      cache: "no-store", credentials: "same-origin", headers: { "X-Duanju-Site": "china" },
    }).then(async response => {
      if (!response.ok) throw new Error("无法建立独立创作空间，请刷新页面重试。");
      const value = await response.json() as StudioSpace;
      if (!value.space_id || !value.isolated) throw new Error("创作空间验证失败，请刷新页面重试。");
      spaceId = value.space_id;
      return value;
    });
    // Coordinate first visits in multiple tabs before either tab sends writes.
    const request = (async () => typeof navigator !== "undefined" && navigator.locks
      ? await navigator.locks.request("plotloom-space", establish) : await establish())();
    spaceRequest = request.catch(() => {
      spaceRequest = undefined; spaceId = undefined;
      throw new Error("无法建立独立创作空间，请检查连接并刷新；请求不会自动重试。");
    });
  }
  return spaceRequest;
}

export async function backendRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (path.startsWith("/studio/") && path !== "/studio/session") await ensureStudioSpace();
  let response: Response;
  try {
    response = await fetch(`/api/backend${path}`, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Duanju-Site": "china",
        ...init.headers,
      },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    throw new Error(
      "无法连接创作服务，请稍后刷新；请求不会自动重试。",
    );
  }
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    if (response.status === 401) { spaceRequest = undefined; spaceId = undefined; }
    const detail =
      typeof data === "object" && data !== null ? data.detail : undefined;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((item: { msg?: string }) => item.msg || "参数无效")
              .join("；")
          : "创作服务请求失败，请稍后重试或联系维护者。";
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
    novel_settings,
    drama_settings,
    market,
    output_locale,
    legacy_id,
    reference_ids,
    world_snapshot,
    creative,
    archived,
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
    novel_settings,
    drama_settings,
    market,
    output_locale,
    legacy_id,
    reference_ids,
    world_snapshot,
    creative,
    archived,
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
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
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
    ...(work.creative ? [`\n创作参数\n${JSON.stringify(work.creative, null, 2)}`] : []),
    ...(work.world_snapshot ? [`\n作品世界副本\n${JSON.stringify(work.world_snapshot, null, 2)}`] : []),
    ...work.chapters.map(
      (chapter) =>
        `\n第${chapter.number}${unit} ${chapter.title}\n${chapter.content}`,
    ),
  ].join("\n");
}
