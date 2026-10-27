"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArrowRight, BookOpen, Copy, FileText, RefreshCw, Search, Trash2 } from "lucide-react";
import { Header, Modal } from "@/components/sites/storyplay/shared";
import { StudioNav } from "./navigation";
import { backendRequest as api, jsonBody, downloadText, unitLabel, type WorkSummary } from "@/lib/studio/api";
import { librarySnapshot, rememberLibrary, visibleWorks, type LibraryState, type LibrarySort } from "@/lib/studio/library";
import { legacyWorks } from "@/lib/studio/legacy";

type History = { id: string; title: string; chapters: number; status: string };
const date = (value: number) => new Date(value).toLocaleDateString("zh-CN");

export function WorksLibrary() {
  const [works, setWorks] = useState<WorkSummary[]>(() => librarySnapshot() || []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [state, setState] = useState<LibraryState>("all");
  const [sort, setSort] = useState<LibrarySort>("updated");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<History[]>([]);
  const [preview, setPreview] = useState("");
  const [removing, setRemoving] = useState<WorkSummary>();
  const sequence = useRef(0);
  const locked = useRef(false);
  const commit = useCallback((items: WorkSummary[]) => {
    rememberLibrary(items);
    setWorks(items);
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++sequence.current;
    const data = await api<{ items: WorkSummary[] }>("/studio/works?view=summary", { signal });
    if (!signal?.aborted && request === sequence.current) {
      commit(data.items); setLoading(false); setError("");
    }
  }, [commit]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(cause => {
      if (!controller.signal.aborted) { setError(cause.message); setLoading(false); }
    });
    return () => controller.abort();
  }, [load]);

  async function run(action: () => Promise<unknown>, refresh = true) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true); setNotice(""); setError("");
    try {
      await action();
      if (refresh) await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试");
      return false;
    } finally { locked.current = false; setBusy(false); setLoading(false); }
  }
  async function archive(work: WorkSummary) {
    await run(async () => {
      ++sequence.current;
      const updated = await api<WorkSummary>(`/studio/works/${work.id}/archive`, {
        method: "PATCH", body: jsonBody({ archived: !work.archived, revision: work.revision }),
      });
      commit(works.map(item => item.id === updated.id ? updated : item));
      setNotice(updated.archived ? "作品已归档，可在全部作品或已归档中查看。" : "作品已恢复至创作中。");
    }, false);
  }
  async function remove(work: WorkSummary) {
    const success = await run(async () => {
      ++sequence.current;
      await api(`/studio/works/${work.id}?revision=${work.revision}`, { method: "DELETE" });
      commit(works.filter(item => item.id !== work.id));
      try { localStorage.removeItem(`plotloom-unsaved-${work.id}`); localStorage.removeItem(`plotloom-create-warning-${work.id}`); }
      catch { /* The server deletion already succeeded. */ }
      setNotice(`已删除《${work.title}》。`);
    }, false);
    if (success) setRemoving(undefined);
  }
  const visible = visibleWorks(works, query, filter, state, sort);
  const archivedCount = works.filter(work => work.archived).length;
  const novels = works.filter(work => work.content_type === "novel").length;

  return <div className="workspace-page"><Header workspace /><div className="plotloom-shell"><StudioNav selected="我的作品" /><main className="plotloom-main works-library">
    <div className="workspace-title library-heading"><div><h1>我的作品</h1></div><span className="library-total">{works.length} 部作品<span>{archivedCount} 部已归档</span></span></div>
    <section className="library-controls" aria-label="作品筛选">
      <div className="library-type-tabs" aria-label="作品类型">
        {[["", "全部作品", works.length], ["novel", "小说", novels], ["short_drama", "剧本", works.length - novels]].map(([value, label, count]) => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(String(value))}>{label}<span>{count}</span></button>)}
      </div>
      <div className="library-toolbar">
        <label className="library-search"><Search size={17} aria-hidden="true" /><input aria-label="搜索作品" placeholder="搜索作品名称" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label="作品状态筛选" value={state} onChange={event => setState(event.target.value as LibraryState)}><option value="all">全部状态</option><option value="active">创作中</option><option value="archived">已归档</option></select>
        <select aria-label="作品排序" value={sort} onChange={event => setSort(event.target.value as LibrarySort)}><option value="updated">最近更新</option><option value="created">最近创建</option><option value="title">作品名称</option></select>
        <button className="outline-button" disabled={busy} onClick={() => void run(() => load(), false)}><RefreshCw size={14} />刷新</button>
      </div>
    </section>
    {notice && <p className="studio-inline-notice" role="status">{notice}</p>}
    {error && !removing && <p className="studio-error" role="alert">{error}</p>}
    <div className="library-results-label"><span>{visible.length} 部作品</span>{loading && <span role="status">正在更新作品列表…</span>}</div>
    <div className="library-grid">{visible.map(work => {
      const novel = work.content_type === "novel";
      const Icon = novel ? BookOpen : FileText;
      const progress = Math.min(100, Math.round(work.completed_units / work.units * 100));
      return <article className={`library-card ${work.archived ? "is-archived" : ""}`} key={work.id}>
        <Link className="library-card-main" href={`/studio/works/${work.id}`}>
          <div className="library-card-top"><span className={`library-kind ${novel ? "is-novel" : ""}`}><Icon size={16} />{novel ? "小说" : "剧本"}</span><span className={`library-state ${work.archived ? "archived" : ""}`}>{work.archived ? <Archive size={12} /> : <span className="library-state-dot" />}{work.archived ? "已归档" : "创作中"}</span></div>
          <h2>{work.title}</h2><p className="library-genre">{work.genre || "未分类"}</p>
          <div className="library-progress-label"><span>正文进度</span><span>{work.completed_units} / {work.units} {unitLabel(work.content_type)}</span></div>
          <progress value={work.completed_units} max={work.units} aria-label={`${work.title} 正文进度 ${progress}%`} />
          <div className="library-card-meta"><time dateTime={new Date(work.updated_at).toISOString()}>{date(work.updated_at)} 更新</time><span>继续创作 <ArrowRight size={14} /></span></div>
        </Link>
        <div className="library-card-actions">
          <button disabled={busy} onClick={() => void run(async () => { await api(`/studio/works/${work.id}/duplicate`, { method: "POST", body: "{}" }); setNotice("已创建独立副本。"); })}><Copy size={14} />复制</button>
          <button disabled={busy} onClick={() => void archive(work)}><Archive size={14} />{work.archived ? "恢复" : "归档"}</button>
          <button disabled={busy} className="library-delete" aria-label={`删除《${work.title}》`} onClick={() => { setError(""); setRemoving(work); }}><Trash2 size={14} />删除</button>
        </div>
      </article>;
    })}</div>
    {loading && !works.length ? <div className="library-skeletons" aria-hidden="true">{[0, 1, 2].map(item => <div key={item} />)}</div> : !visible.length && <div className="library-empty"><BookOpen size={32} /><h2>{works.length ? "没有找到匹配的作品" : "你的故事，从这里开始"}</h2><p>{works.length ? "试试其他关键词、作品类型或归档状态。" : "从侧栏进入小说或剧本创作，保存后的作品会统一显示在这里。"}</p>{works.length > 0 && <button className="outline-button" onClick={() => { setQuery(""); setFilter(""); setState("all"); }}>清除筛选</button>}</div>}
    <details className="library-import"><summary>导入与历史作品<span>备份导入 · 浏览器旧草稿 · 旧站中文历史</span></summary><div>
      <p className="studio-hint">导入为独立作品，保留原件；旧草稿和中文旧站任务按原始 ID 去重。</p>
      <div className="studio-candidate-actions"><label className="outline-button studio-import-world">导入完整作品备份<input type="file" accept=".json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(async () => { if (file.size > 12 * 1024 * 1024) throw new Error("文件超过12 MB"); await api("/studio/works/import", { method: "POST", body: await file.text() }); setNotice("已导入为新作品"); }); }} /></label>
        <button className="outline-button" disabled={busy} onClick={() => void run(async () => { const items = legacyWorks(localStorage.getItem("storyplay-local-projects-v1")); for (const value of items) await api("/studio/works", { method: "POST", body: jsonBody(value) }); setNotice(`已处理 ${items.length} 份旧草稿，原数据保留`); })}>导入浏览器旧草稿</button>
        <button className="outline-button" disabled={busy} onClick={() => void run(async () => setHistory((await api<{ items: History[] }>("/studio/history")).items), false)}>查看旧站中文历史</button></div>
      {history.map(item => <article className="studio-candidate" key={item.id}><h3>{item.title}</h3><p>{item.chapters} 个正文单元 · 只读历史</p><button className="text-button" disabled={busy} onClick={() => void run(async () => setPreview(await api<string>(`/studio/history/${item.id}/preview`)), false)}>预览</button><button className="outline-button" disabled={busy} onClick={() => void run(async () => { await api(`/studio/history/${item.id}/import`, { method: "POST", body: "{}" }); setNotice("已导入，重复操作不会覆盖作品。"); })}>导入为新作品</button></article>)}
      {preview && <details open><summary>历史原稿预览</summary><pre className="plotloom-pre">{preview}</pre><button className="outline-button" onClick={() => downloadText("历史原稿.txt", preview)}>导出预览</button></details>}
    </div></details>
    {removing && <Modal title="删除作品" onClose={() => { if (!locked.current) setRemoving(undefined); }}>
      <p className="library-delete-title">确认删除《{removing.title}》？</p><p className="modal-description">正文、作品世界副本和生成记录将一并删除，无法恢复。也可以使用归档保留作品。</p>
      {error && <p className="studio-error" role="alert">{error}</p>}
      <div className="library-delete-actions"><button className="outline-button" disabled={busy} onClick={() => void run(async () => downloadText(`${removing.title}.json`, jsonBody(await api(`/studio/works/${removing.id}/backup`)), "application/json"), false)}>下载完整备份</button><button className="outline-button" disabled={busy} onClick={() => setRemoving(undefined)}>取消</button><button className="library-confirm-delete" disabled={busy} onClick={() => void remove(removing)}>{busy ? "处理中…" : "确认删除"}</button></div>
    </Modal>}
  </main></div></div>;
}
