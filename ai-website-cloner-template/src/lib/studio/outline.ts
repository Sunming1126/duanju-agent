export type OutlineEntry = { number: number; phase: number; text: string };
export type OutlineDocument = { rough: string; entries: OutlineEntry[]; structured: boolean; source?: string };

const HEADER = "【Plotloom 大纲 v1】";
const END = "【大纲结束】";
const indent = (value: string) => value.split("\n").map(line => `    ${line}`).join("\n");

/** Readable plain text; indent every content line so literal markers cannot become structure. */
export function serializeOutline(document: Pick<OutlineDocument, "rough" | "entries">): string {
  return [HEADER, "粗纲：", indent(document.rough), ...document.entries.flatMap(entry => [
    `【单元 ${entry.number} 阶段 ${entry.phase}】`, indent(entry.text),
  ]), END].join("\n");
}

/** Explicit numbered headings delimit units; retain every following paragraph verbatim. */
function parsePlainOutline(value: string): OutlineDocument | null {
  const chunks = value.match(/[^\n]*\n|[^\n]+$/g) || [];
  const entries: OutlineEntry[] = [];
  let rough = "";
  let unit = "";
  for (const chunk of chunks) {
    const line = chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk;
    if (/^[\t \r]*$/.test(line)) {
      if (entries.length) entries[entries.length - 1].text += chunk;
      else rough += chunk;
      continue;
    }
    const marker = /^第([1-9]\d*)(集|章)：/.exec(line);
    if (!marker) {
      if (!entries.length || /^第[\d一二三四五六七八九十百]+(?:集|章)[：:]/.test(line)) return null;
      entries[entries.length - 1].text += chunk;
      continue;
    }
    if (unit && marker[2] !== unit) return null;
    const number = Number(marker[1]);
    if (!Number.isSafeInteger(number) || entries.some(entry => entry.number === number)) return null;
    unit = marker[2];
    // Keep the literal label and all spacing: canonicalizing an edited card must not erase source text.
    entries.push({ number, phase: 0, text: chunk });
  }
  return entries.length ? { rough, entries, structured: true, source: value } : null;
}

/** Unknown formats stay verbatim in rough; no heuristic split of Markdown or arbitrary AI prose. */
export function parseOutline(value: string): OutlineDocument {
  const fallback: OutlineDocument = { rough: value, entries: [], structured: false };
  const lines = value.split("\n");
  if (lines[0] !== HEADER || lines[1] !== "粗纲：" || lines.at(-1) !== END) return parsePlainOutline(value) || fallback;
  const entries: OutlineEntry[] = [];
  let body: string[] = [];
  let current: OutlineEntry | null = null;
  let rough = "";
  for (let index = 2; index < lines.length - 1; index++) {
    const line = lines[index];
    if (line.startsWith("    ")) { body.push(line.slice(4)); continue; }
    const marker = /^【单元 ([1-9]\d*) 阶段 ([0-3])】$/.exec(line);
    if (!marker || !body.length) return fallback;
    if (current) { current.text = body.join("\n"); entries.push(current); }
    else rough = body.join("\n");
    const number = Number(marker[1]);
    if (!Number.isSafeInteger(number) || entries.some(entry => entry.number === number)) return fallback;
    current = { number, phase: Number(marker[2]), text: "" }; body = [];
  }
  if (!body.length) return fallback;
  if (current) { current.text = body.join("\n"); entries.push(current); }
  else rough = body.join("\n");
  const document = { rough, entries, structured: true };
  return serializeOutline(document) === value ? document : fallback;
}

export function nextOutlineNumber(entries: { number: number }[], units: number): number | null {
  if (!Number.isInteger(units) || units < 1 || units > 200) return null;
  const used = new Set(entries.map(entry => entry.number));
  for (let number = 1; number <= units; number++) if (!used.has(number)) return number;
  return null;
}
