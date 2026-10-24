"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/sites/storyplay/shared";
import { StudioNav } from "./editor";
import { backendRequest as api, jsonBody, workPayload, downloadText, type Work } from "@/lib/studio/api";
import { legacyWorks } from "@/lib/studio/legacy";

type History = { id: string; title: string; chapters: number; status: string };
export function WorksLibrary() {
  const [works, setWorks] = useState<Work[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [archived, setArchived] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<History[]>([]);
  const [preview, setPreview] = useState("");
  const load = useCallback(async () => {
    const data = await api<{ items: Work[] }>("/studio/works");
    setWorks(data.items); setLoading(false);
  }, []);
  useEffect(() => { load().catch(e => { setNotice(e.message); setLoading(false); }); }, [load]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setNotice("");
    try { await action(); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  async function archive(work: Work) {
    await api(`/studio/works/${work.id}`, { method: "PUT", body: jsonBody({ ...workPayload(work), archived: !work.archived, revision: work.revision }) });
  }
  return <div className="workspace-page"><Header workspace /><div className="plotloom-shell"><StudioNav selected="我的作品" /><main className="plotloom-main">
    <div className="workspace-title"><div><span className="eyebrow">CREATIVE WORKSPACE</span><h1>我的作品</h1></div><Link className="pill light" href="/studio/scripts/new">新建剧本</Link><Link className="outline-button" href="/studio/novels/new">新建小说</Link></div>
    <div className="creation-grid">{[["小说改编", "adapt"], ["剧本改写", "rewrite"], ["灵感策划", "inspiration"]].map(([label, mode]) => <Link className="creation-card" key={mode} href={`/studio/scripts/new?mode=${encodeURIComponent(label)}`}><h2>{label}</h2><p>完整创作页面 · 保留原始输入</p></Link>)}</div>
    <div className="works-toolbar"><input aria-label="搜索作品" placeholder="搜索作品名称" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="作品类型筛选" value={filter} onChange={e => setFilter(e.target.value)}><option value="">全部类型</option><option value="short_drama">剧本</option><option value="novel">小说</option></select><label><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />归档作品</label><button className="text-button" onClick={() => void run(load)}>刷新</button></div>
    {notice && <p className="studio-inline-notice" role="status">{notice}</p>}
    <div className="project-grid">{works.filter(w => !!w.archived === archived && (!filter || w.content_type === filter) && w.title.toLowerCase().includes(query.toLowerCase())).map(w => <article className="project-card" key={w.id}><div className="project-info"><Link href={`/studio/works/${w.id}`}><h2>{w.title}</h2><p>{w.content_type === "novel" ? "小说" : "剧本"} · {w.chapters.filter(c => c.content).length}/{w.units} · v{w.revision}</p></Link><div className="studio-candidate-actions"><button disabled={busy} className="outline-button" onClick={() => void run(async () => { await api(`/studio/works/${w.id}/duplicate`, { method: "POST", body: "{}" }); })}>复制</button><button disabled={busy} className="outline-button" onClick={() => void run(() => archive(w))}>{w.archived ? "恢复" : "归档"}</button></div></div></article>)}</div>
    {loading ? <p>正在读取作品…</p> : !works.some(w => !!w.archived === archived) && <p className="empty-workspace">此列表还没有作品。</p>}
    <section className="studio-candidate"><h2>导入与历史作品</h2><p className="studio-hint">导入会创建独立作品。浏览器旧草稿及中文旧站任务按原始 ID 去重，保留原件；未知市场不自动导入。</p>
      <div className="studio-candidate-actions"><label className="outline-button studio-import-world">导入完整作品备份<input type="file" accept=".json" disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(async () => { if (f.size > 12 * 1024 * 1024) throw new Error("文件超过12 MB"); await api("/studio/works/import", { method: "POST", body: await f.text() }); setNotice("已导入为新作品"); }); }} /></label>
        <button className="outline-button" disabled={busy} onClick={() => void run(async () => { const items = legacyWorks(localStorage.getItem("storyplay-local-projects-v1")); for (const value of items) await api("/studio/works", { method: "POST", body: jsonBody(value) }); setNotice(`已处理 ${items.length} 份旧草稿，原数据保留`); })}>导入浏览器旧草稿</button>
        <button className="outline-button" disabled={busy} onClick={() => void run(async () => setHistory((await api<{ items: History[] }>("/studio/history")).items))}>查看旧站中文历史</button></div>
      {history.map(h => <article className="studio-candidate" key={h.id}><h3>{h.title}</h3><p>{h.chapters} 个正文单元 · 只读历史</p><button className="text-button" onClick={() => void run(async () => setPreview(await api<string>(`/studio/history/${h.id}/preview`)))}>预览</button><button className="outline-button" disabled={busy} onClick={() => void run(async () => { await api(`/studio/history/${h.id}/import`, { method: "POST", body: "{}" }); setNotice("已显式导入；重复操作不会覆盖作品"); })}>导入为新作品</button></article>)}
      {preview && <details open><summary>历史原稿预览</summary><pre className="plotloom-pre">{preview}</pre><button className="outline-button" onClick={() => downloadText("历史原稿.txt", preview)}>导出预览</button></details>}
    </section>
  </main></div></div>;
}
