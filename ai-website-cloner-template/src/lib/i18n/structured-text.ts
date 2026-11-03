import type { Locale } from "./config";
// Only known storage delimiters change for full-text editing. Indented prose and
// every unknown line remain byte-for-byte intact, including literal field names.
const words = {
  "zh-TW": ["人物", "人物結束", "定位", "年齡", "性格", "背景", "人物關係", "大綱", "粗綱", "單元", "階段", "大綱結束"],
  en: ["Character", "End character", "Role", "Age", "Traits", "Background", "Relationships", "Outline", "Synopsis", "Unit", "Phase", "End outline"],
  "ja-JP": ["人物", "人物終了", "役割", "年齢", "性格", "背景", "人物関係", "構成", "全体あらすじ", "単位", "段階", "構成終了"],
  ar: ["شخصية", "نهاية الشخصية", "الدور", "العمر", "السمات", "الخلفية", "العلاقات", "مخطط", "الملخص العام", "وحدة", "مرحلة", "نهاية المخطط"],
};
const fields = ["定位", "年龄", "性格", "背景", "人物关系"];
export function structuredText(text: string, locale: Locale = "zh-CN", toStorage = false): string {
  if (locale === "zh-CN") return text;
  const w = words[locale];
  return text.split("\n").map(line => {
    const pairs = [["【人物结束】", `【${w[1]}】`], ["【Plotloom 大纲 v1】", `【Plotloom ${w[7]} v1】`], ["【大纲结束】", `【${w[11]}】`], ["粗纲：", `${w[8]}:`]];
    const match = pairs.find(pair => pair[toStorage ? 1 : 0] === line);
    if (match) return match[toStorage ? 0 : 1];
    const start = toStorage ? `【${w[0]}:` : "【人物：";
    if (line.startsWith(start) && line.endsWith("】")) return `${toStorage ? "【人物：" : `【${w[0]}:`}${line.slice(start.length)}`;
    for (const [i, field] of fields.entries()) {
      const prefix = toStorage ? `${w[i + 2]}:` : `${field}：`;
      if (line.startsWith(prefix)) return `${toStorage ? `${field}：` : `${w[i + 2]}:`}${line.slice(prefix.length)}`;
    }
    const unit = line.match(toStorage ? new RegExp(`^【${w[9]} ([1-9]\\d*) ${w[10]} ([0-4])】$`) : /^【单元 ([1-9]\d*) 阶段 ([0-4])】$/);
    if (unit) return toStorage ? `【单元 ${unit[1]} 阶段 ${unit[2]}】` : `【${w[9]} ${unit[1]} ${w[10]} ${unit[2]}】`;
    return line;
  }).join("\n");
}
