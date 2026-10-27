export type CharacterCard = {
  name: string; role: string; age: string; traits: string[]; background: string; relationships: string;
  /** Unedited blocks retain their original prose, including unknown fields. */
  source?: string;
};

export function newCharacter(): CharacterCard {
  return { name: "新角色", role: "", age: "", traits: [], background: "", relationships: "" };
}

const marker = /^【人物[：:]([^\n]*)】\s*$/;
const label = /^(定位|年龄|性格|背景|人物关系)[：:](.*)$/;

function readBlock(source: string): CharacterCard {
  const lines = source.split("\n");
  const title = lines[0].match(marker);
  const card = { ...newCharacter(), name: title ? title[1] : "未整理人物", source };
  if (!title) {
    // Legacy prose stays verbatim in the background; do not infer missing facts.
    const heading = lines[0].replace(/^\s*#{1,6}\s*/, "").replace(/^\s*(?:\d+|[一二三四五六七八九十]+)[.、）)]\s*/, "").replace(/^姓名[：:]\s*/, "");
    const name = heading.match(/^([^，,（(：:\s]{1,16})(?:[，,（(：:]|$)/)?.[1];
    if (name) card.name = name;
    const explicit = (keys: string) => source.match(new RegExp(`^\\s*(?:[-*]\\s*)?(?:${keys})[：:]\\s*([^\\n]*)`, "m"))?.[1] || "";
    card.role = explicit("定位|角色定位");
    card.age = explicit("年龄") || lines[0].match(/[，,（(]\s*(\d{1,3})岁/)?.[1] || "";
    card.traits = explicit("性格").split(/[、，,]/).map(s => s.trim()).filter(Boolean);
    card.relationships = explicit("人物关系");
    card.background = source;
    return card;
  }
  const values: Record<string, string[]> = {};
  const encoded = lines.at(-1) === "【人物结束】";
  let field = "背景";
  for (const line of lines.slice(1, encoded ? -1 : undefined)) {
    const match = line.match(label);
    if (match) { field = match[1]; values[field] ||= []; if (match[2]) values[field].push(match[2]); }
    else if (/^(身份|欲望|弱点|内在冲突|成长弧|成长|对白口吻|对抗关系|性格行动|视角人物)[：:]/.test(line)) { field = "背景"; (values[field] ||= []).push(line); }
    else (values[field] ||= []).push(line.replace(/^  /, ""));
  }
  const value = (key: string) => encoded ? (values[key] || []).join("\n") : (values[key] || []).join("\n").trim();
  card.role = value("定位"); card.age = value("年龄");
  const traits = value("性格");
  card.traits = traits.includes("\n") || traits.startsWith("- ")
    ? traits.split("\n").map(s => s.replace(/^- /, "").trim()).filter(Boolean)
    : traits.split(/[、，,]/).map(s => s.trim()).filter(Boolean);
  card.background = value("背景"); card.relationships = value("人物关系");
  // Unrecognized prose stays in its text field instead of being discarded.
  return card;
}

export function parseCharacters(text: string): CharacterCard[] {
  if (!text.trim()) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const startsLegacy = (line: string) =>
    /^(?:#{1,6}\s+(?:(?:\d+|[一二三四五六七八九十]+)[.、）)]\s*)?[^\s]{1,40}|(?:\d+|[一二三四五六七八九十]+)[.、）)]\s*\S|姓名[：:]\s*\S)/.test(line) ||
    /^[^\s，,：:。]{1,12}[，,]\s*\d{1,3}岁/.test(line);
  const blocks: string[] = [];
  let current: string[] = [];
  let insideCanonical = false;
  for (const line of lines) {
    const starts = marker.test(line) || !insideCanonical && startsLegacy(line);
    if (starts && current.some(s => s.trim())) { blocks.push(current.join("\n")); current = []; }
    if (marker.test(line)) insideCanonical = true;
    current.push(line);
    if (line === "【人物结束】") insideCanonical = false;
  }
  if (current.some(s => s.trim())) blocks.push(current.join("\n"));
  return blocks.map(block => readBlock(block.trim()));
}

export function serializeCharacters(cards: CharacterCard[]): string {
  const indent = (value: string) => value.split("\n").map(line => `  ${line}`).join("\n");
  return cards.map(card => card.source ?? [
    `【人物：${card.name.replace(/[\r\n]/g, " ")}】`, "定位：", indent(card.role), "年龄：", indent(card.age),
    "性格：", ...card.traits.map(trait => `  - ${trait}`), "背景：", indent(card.background), "人物关系：", indent(card.relationships), "【人物结束】",
  ].join("\n")).join("\n\n");
}
