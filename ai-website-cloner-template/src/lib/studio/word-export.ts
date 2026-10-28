import { downloadText, type Chapter } from "./api";
function escape(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
/** Word-compatible HTML .doc; escapes all user text instead of accepting markup. */
export function wordDocument(title: string, chapters: Chapter[]) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title></head><body><h1>${escape(title)}</h1>${[...chapters].sort((a,b)=>a.number-b.number).map(c=>`<h2>${escape(c.title)}</h2><p>${escape(c.content).replaceAll("\n","<br>")}</p>`).join("")}</body></html>`;
}
export function exportWord(title: string, chapters: Chapter[]) {
  downloadText(`${title.replace(/[\\/:*?"<>|]/g,"-") || "作品"}.doc`, "\ufeff" + wordDocument(title, chapters), "application/msword;charset=utf-8");
}
