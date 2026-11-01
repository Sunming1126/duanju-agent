import messages from "./messages.json";
import type { Locale } from "./config";
type Entry = string[];
const catalog = messages as Record<string, Entry>;
const statusLabels: Record<string, string> = { queued: "排队中", running: "生成中", completed: "已完成", failed: "失败", interrupted: "已中断", stopping: "正在停止", stopped: "已停止" };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(catalog).filter(([key]) => /\{\d+\}/.test(key))
  .sort(([a], [b]) => b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length)
  .map(([key, values]) => ({
  key,
  regex: new RegExp("^" + key.split(/(\{\d+\})/).map(part => /^\{\d+\}$/.test(part)
    ? part === "{0}" && /(?:第|计划 )\{0\}/.test(key) ? "(\\d+)" : "(.+?)" : escape(part)).join("") + "$", "s"),
  slots: [...key.matchAll(/\{(\d+)\}/g)].map(m => Number(m[1])), values,
}));
export function localizedError(message: string, locale: Locale, status = 500): string {
  const ui = createTranslator(locale);
  const translated = ui(message);
  if (locale === "zh-CN" || translated !== message || !/[\u3400-\u9fff]/.test(message)) return translated;
  const fallback = status === 401 ? "登录状态已过期，请刷新后登录。" : status === 403 ? "当前操作不被允许，请刷新并核对账号。" : status === 404 ? "内容不存在或当前账号无权访问。" : status === 409 ? "内容或任务状态已变化，请刷新核对；当前编辑保留。" : status === 422 ? "输入不符合要求，请检查必填项、数量和长度。" : status === 429 ? "请求暂时过多，请稍后主动重试。" : "创作服务请求失败，请稍后重试或联系维护者。";
  return ui(fallback);
}
export function createTranslator(locale: Locale = "zh-CN") {
  const index = locale === "en" ? 0 : locale === "ja-JP" ? 1 : 2;
  function ui<T>(value: T, error = false): T {
    if (error && typeof value === "string") return localizedError(value, locale) as T;
    if (typeof value !== "string" || !value) return value;
    value = (statusLabels[value] || value) as T;
    if (locale === "zh-CN") return value;
    if (typeof value !== "string") return value;
    const key = value.replace(/\s+/g, " ").trim();
    const entry = catalog[key];
    if (entry) return value.replace(value.trim(), entry[index]) as T;
    for (const pattern of patterns) {
      const match = key.match(pattern.regex);
      if (!match) continue;
      const slots: Record<number, string> = {};
      pattern.slots.forEach((slot, i) => {
        const userSlot = /^(?:删除《|已删除《|添加“|移除性格：)/.test(pattern.key) ||
          pattern.key === "移除{0}：{1}" && slot === 1;
        slots[slot] = userSlot ? match[i + 1] : ui(match[i + 1]);
      });
      return pattern.values[index].replace(/\{(\d+)\}/g, (_, slot) => slots[Number(slot)] || "") as T;
    }
    return value;
  }
  return ui;
}
