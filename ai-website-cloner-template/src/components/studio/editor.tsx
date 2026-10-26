"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "@/components/sites/storyplay/shared";
import { backendRequest as api, jsonBody, workPayload, downloadText, localExport, unitLabel,
  type Work, type World, type StudioStatus, type Action, type Reference, type WorldInput, type Candidate } from "@/lib/studio/api";
import { WorkForm } from "./work-form";
import { StudioNav } from "./navigation";
import { worldDraftChecksum } from "@/lib/studio/world-codec";
import { creationMode } from "@/lib/studio/writing";
import { WritingOptions } from "./writing-options";

type Result = { action: Action | "world"; number: number; text: string; adopted: boolean; references: Reference[] };
type Job = { id: string; status: string; completed: number; total: number; error: string;
  current: { action: string; number: number }; results?: Result[]; base_revision: number };
const baseLabels = { premise: "故事设定", characters: "人物小传", outline: "大纲", chapter: "正文", world: "作品世界" };
const active = ["queued", "running", "stopping"];

export function StudioEditor({ id, kind = "short_drama", mode, referenceId = "" }: {
  id?: string; kind?: "short_drama" | "novel"; mode?: string; referenceId?: string;
}) {
  const router = useRouter();
  const [work, setWork] = useState<Work | null>(null);
  const [worlds, setWorlds] = useState<World[]>([]);
  const [status, setStatus] = useState<StudioStatus>();
  const [reference, setReference] = useState<Reference>();
  const [referenceReady, setReferenceReady] = useState(!referenceId);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Action>("premise");
  const [number, setNumber] = useState(1);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [legacyCandidates, setLegacyCandidates] = useState<Candidate[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job>();
  const [worldOpen, setWorldOpen] = useState(true);
  const [recovery, setRecovery] = useState("");
  const mutating = useRef(false);
  const requestKey = useRef("");
  const refreshSequence = useRef(0);
  const creation = creationMode(kind, mode);
  const isNovel = (work?.content_type || kind) === "novel";
  const labels = { ...baseLabels, premise: isNovel ? "小说设定" : "剧本设定", characters: isNovel ? "人物档案" : "人物小传", outline: isNovel ? "章节大纲" : "分集大纲", chapter: isNovel ? "章节正文" : "分场剧本" };

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const auxiliaryError = (cause: Error) => { if (!signal.aborted) setNotice(cause.message); };
    // Supporting panels must not hold the manuscript or creation form hostage.
    void api<StudioStatus>("/studio/status", { signal }).then(value => {
      if (!signal.aborted) setStatus(value);
    }).catch(auxiliaryError);
    void api<{ items: World[] }>("/studio/worlds", { signal }).then(value => {
      if (!signal.aborted) setWorlds(value.items.filter(world => !world.archived));
    }).catch(auxiliaryError);
    if (referenceId) void api<Reference>(`/studio/references/${encodeURIComponent(referenceId)}`, { signal }).then(value => {
      if (!signal.aborted) { setReference(value); setReferenceReady(true); }
    }).catch(cause => { if (!signal.aborted) setError(cause.message); });
    if (id) void api<{ items: Candidate[] }>(`/studio/works/${id}/candidates`, { signal }).then(value => {
      if (!signal.aborted) setLegacyCandidates(value.items);
    }).catch(auxiliaryError);
    if (id) void api<Work>(`/studio/works/${id}`, { signal }).then(value => {
      if (signal.aborted) return;
      setWork(value);
      try {
        const raw = localStorage.getItem(`plotloom-unsaved-${id}`);
        if (raw) {
          try {
            const cached = JSON.parse(raw) as Work;
            if (cached.id === value.id && cached.revision === value.revision) { setWork(cached); setDirty(true); setNotice("已恢复此浏览器未保存编辑，正在自动保存。"); }
            else { setWork(value); setRecovery(raw); setNotice("发现基于旧版本的本地编辑，请导出备份；未覆盖服务器作品。"); }
          } catch { setWork(value); setRecovery(raw); }
        }
        const warning = localStorage.getItem(`plotloom-create-warning-${id}`);
        if (warning) { setNotice(warning); localStorage.removeItem(`plotloom-create-warning-${id}`); }
      } catch { setNotice("浏览器草稿备份不可用，已读取服务器作品。"); }
    }).catch(e => { if (!signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [id, referenceId]);

  const update = (patch: Partial<Work>) => {
    if (!work || mutating.current) return;
    const next = { ...work, ...patch };
    setWork(next); setDirty(true);
    try { localStorage.setItem(`plotloom-unsaved-${work.id}`, JSON.stringify(next)); }
    catch { setNotice("浏览器草稿备份不可用，请手动保存或导出。"); }
  };

  const persist = useCallback(async (): Promise<Work | null> => {
    if (!work) return null;
    if (!dirty) return work;
    if (mutating.current) return null;
    mutating.current = true; setBusy(true);
    try {
      const saved = await api<Work>(`/studio/works/${work.id}`, { method: "PUT", body: jsonBody({ ...workPayload(work), revision: work.revision }) });
      setWork(saved); setDirty(false); setBlocked(false);
      try { localStorage.removeItem(`plotloom-unsaved-${work.id}`); } catch { /* Server save already succeeded. */ }
      setNotice("已保存"); return saved;
    } catch (e) {
      setBlocked(true); setNotice(`${e instanceof Error ? e.message : "保存失败"}。本地编辑保留，可导出备份。`); return null;
    } finally { mutating.current = false; setBusy(false); }
  }, [work, dirty]);

  useEffect(() => {
    if (!dirty || blocked || busy) return;
    const timer = setTimeout(() => { void persist(); }, 1800);
    return () => clearTimeout(timer);
  }, [dirty, blocked, busy, persist]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  const selectedId = selectedJob?.id;
  const refreshJobs = useCallback(async (signal?: AbortSignal) => {
    if (!id) return;
    const sequence = ++refreshSequence.current;
    const data = await api<{ items: Job[] }>(`/studio/works/${id}/jobs`, { signal });
    if (signal?.aborted || sequence !== refreshSequence.current) return;
    const target = selectedId || data.items[0]?.id;
    const detail = target ? await api<Job>(`/studio/jobs/${target}`, { signal }) : undefined;
    if (signal?.aborted || sequence !== refreshSequence.current) return;
    setJobs(data.items);
    if (detail) setSelectedJob(detail);
  }, [id, selectedId]);
  useEffect(() => {
    if (!id) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try { await refreshJobs(controller.signal); }
      catch (e) { if (!disposed) setNotice(e instanceof Error ? e.message : "读取生成进度失败"); }
      if (!disposed) timer = setTimeout(() => void poll(), 2500);
    };
    void poll();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [id, refreshJobs]);

  async function generate(action: Action | "world", all = false, continuation = false) {
    if (!work || mutating.current) return;
    const saved = await persist();
    if (!saved) return;
    if (!saved.premise.trim()) { setNotice("请先填写故事想法或梗概。"); return; }
    mutating.current = true; setBusy(true);
    try {
      // Keep the same key after an uncertain network response. Editing the work
      // produces another revision and therefore another request identity.
      const targetNumber = action === "chapter" ? Math.min(number, saved.units) : 1;
      const signature = `${saved.id}:${saved.revision}:${action}:${targetNumber}:${all}:${continuation}`;
      if (!requestKey.current.startsWith(signature + ":")) requestKey.current = `${signature}:${crypto.randomUUID()}`;
      const job = await api<Job>(`/studio/works/${saved.id}/jobs`, { method: "POST", body: jsonBody({ revision: saved.revision, action, number: targetNumber, mode: all ? "all" : "single", request_key: requestKey.current, continuation }) });
      setSelectedJob(await api<Job>(`/studio/jobs/${job.id}`));
      setNotice(all ? `已排队生成全部 ${saved.units}${unitLabel(saved.content_type)}，原稿将保留。` : "已提交分步生成，完成后请审阅并采纳。");
      setJobs((await api<{ items: Job[] }>(`/studio/works/${saved.id}/jobs`)).items);
      requestKey.current = "";
    } catch (e) { setNotice(e instanceof Error ? e.message : "提交失败，请刷新任务列表核对"); }
    finally { mutating.current = false; setBusy(false); }
  }

  async function control(job: Job, action: "stop" | "resume") {
    try { await api(`/studio/jobs/${job.id}/${action}`, { method: "POST", body: "{}" }); await refreshJobs(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "操作失败"); }
  }

  async function adopt(index?: number) {
    if (!selectedJob || !work || busy || mutating.current) return;
    if (dirty) { setNotice("请先保存或导出当前编辑；修改后的作品会阻止旧稿覆盖。"); return; }
    mutating.current = true; setBusy(true);
    try {
      const saved = await api<Work>(`/studio/jobs/${selectedJob.id}${index === undefined ? "/adopt" : `/results/${index}/adopt`}`, { method: "POST", body: "{}" });
      setWork(saved); setDirty(false); setNotice("已采纳并保存"); await refreshJobs();
    } catch (e) { setNotice(e instanceof Error ? e.message : "采纳失败"); }
    finally { mutating.current = false; setBusy(false); }
  }

  async function adoptLegacy(candidate: Candidate) {
    if (!work || busy || dirty || mutating.current) return;
    mutating.current = true; setBusy(true);
    try {
      const saved = await api<Work>(`/studio/works/${work.id}/candidates/${candidate.id}/adopt`, { method: "POST", body: "{}" });
      setWork(saved); setDirty(false); setNotice("旧版候选已采纳并保存");
      setLegacyCandidates(items => items.map(item => item.id === candidate.id ? { ...item, status: "adopted" } : item));
    } catch (e) { setNotice(e instanceof Error ? e.message : "采纳失败，候选仍保留"); }
    finally { mutating.current = false; setBusy(false); }
  }

  async function saveWorldLibrary() {
    const saved = await persist(); if (!saved?.world_snapshot) return;
    try {
      const world = await api<World>(`/studio/works/${saved.id}/world-library`, { method: "POST", body: "{}" });
      setWorlds(items => [world, ...items]); setNotice("作品世界已另存为世界库新条目，原件未覆盖。");
    } catch (e) { setNotice(e instanceof Error ? e.message : "另存失败"); }
  }

  async function exportWorld() {
    if (!work?.world_snapshot) return;
    try {
      const w = work.world_snapshot;
      const payload = { schema: "onesay.world-draft" as const, version: 1 as const,
        world: { name: w.name, description: w.description, sections: w.sections } };
      downloadText(`${w.name}-作品世界.json`, jsonBody({ ...payload, checksum: await worldDraftChecksum(payload) }), "application/json");
    } catch (e) { setNotice(e instanceof Error ? e.message : "导出失败"); }
  }

  const unit = unitLabel(work?.content_type || kind);
  const world = work?.world_snapshot;
  const pending = jobs.some(j => active.includes(j.status));
  const text = work ? tab === "chapter" ? work.chapters.find(c => c.number === number)?.content || "" : work[tab] : "";
  function changeText(content: string) {
    if (!work) return;
    if (tab !== "chapter") update({ [tab]: content });
    else update({ chapters: [...work.chapters.filter(c => c.number !== number), { number, title: `第${number}${unit}`, content }].sort((a, b) => a.number - b.number) });
  }
  function changeWorld(patch: Partial<WorldInput>) {
    update({ world_snapshot: { name: world?.name || "作品专属世界", description: world?.description || "", sections: world?.sections || {}, ...patch } });
  }

  return <div className="workspace-page" onClickCapture={e => {
    if ((dirty || busy) && e.target instanceof Element && e.target.closest("a")) { e.preventDefault(); e.stopPropagation(); setNotice("请先保存或导出当前编辑后离开。"); }
  }}><Header workspace /><div className="plotloom-shell"><StudioNav selected={(work?.content_type || kind) === "novel" ? "小说创作" : "剧本创作"} />
    <main className="plotloom-main">
      {error && <p className="studio-error" role="alert">{error}<button onClick={() => window.location.reload()}>重新加载</button></p>}
      {notice && <p className="studio-inline-notice" role="status">{notice}</p>}
      {recovery && <button className="outline-button" onClick={() => downloadText("旧版本本地编辑.json", recovery)}>导出待核对的本地编辑</button>}
      {!id && !referenceReady ? <p role="status">{error ? "参考资料读取失败，请重新加载。" : "正在读取参考资料…"}</p> : !id ? <>
        <div className="workspace-title"><h1>{creation === "灵感创作" ? `${isNovel ? "小说" : "剧本"}灵感创作` : creation}</h1><span className="studio-hint">{isNovel ? "01 小说设定 → 02 人物档案 → 03 章节大纲 → 04 小说正文" : "01 剧本设定 → 02 人物小传 → 03 分集大纲 → 04 分场剧本"}</span></div>
        <section className="editor-panel plotloom-new"><WorkForm key={`${kind}:${creation}:${reference?.id}`} kind={kind} mode={creation} worlds={worlds} sections={status?.world_sections} reference={reference} onClose={() => router.push("/workspace")} onCreated={async (value, auto) => {
          if (auto) {
            try { await api(`/studio/works/${value.id}/jobs`, { method: "POST", body: jsonBody({ revision: value.revision, action: "premise", request_key: `create-${value.id}` }) }); }
            catch { try { localStorage.setItem(`plotloom-create-warning-${value.id}`, "草稿已创建，生成未确认提交，请查看任务列表后手动生成。"); } catch { /* The saved work must still open. */ } }
          }
          router.push(`/studio/works/${value.id}`);
        }} /></section>
      </> : !work ? <p>正在读取作品…</p> : <>
        <div className="editor-top"><div><input className="project-title-input" aria-label="作品名称" value={work.title} maxLength={80} disabled={busy} onChange={e => update({ title: e.target.value })} /><p>{work.content_type === "novel" ? "小说" : "短剧"} · {work.units}{unit} · v{work.revision}</p></div>
          <div className="editor-actions"><span className="save-state">{busy ? "处理中…" : blocked ? "保存失败" : dirty ? "等待自动保存" : "已保存"}</span>
            <button className="outline-button" onClick={() => downloadText(`${work.title}.txt`, localExport(work))}>导出 TXT</button>
            <button className="outline-button" onClick={() => downloadText(`${work.title}.json`, jsonBody({ schema: "plotloom.work", version: 1, work: workPayload(work) }), "application/json")}>完整备份</button>
            <button className="pill light" disabled={busy} onClick={() => void persist()}>保存</button>
            <button className="pill light" disabled={busy || pending} onClick={() => void generate("premise", true)}>一键生成全部 {work.units}{unit}</button>
          </div></div>
        <div className="plotloom-editor-grid">
          <div className="plotloom-writing">
            <div className="editor-tabs" role="tablist" aria-label="创作步骤">{(["premise", "characters", "outline", "chapter"] as Action[]).map((a, i) => <button key={a} role="tab" aria-selected={a === tab} className={tab === a ? "active" : ""} onClick={() => setTab(a)}><span>0{i + 1}</span>{labels[a]}</button>)}</div>
            {tab === "premise" && <section className="create-form plotloom-settings">
              <WritingOptions kind={work.content_type} novel={work.novel_settings} drama={work.drama_settings} disabled={busy} onChange={patch => update(patch)} />
              <div className="form-row"><label>目标受众<select value={work.audience} disabled={busy} onChange={e => update({ audience: e.target.value as Work["audience"] })}><option value="general">不限</option><option value="male">男性向</option><option value="female">女性向</option></select></label>
                <NumberSetting key={`${work.id}:units:${work.units}`} label={`计划${unit}数`} min={Math.max(1, ...work.chapters.map(c => c.number))} max={200} value={work.units} disabled={busy} onChange={value => { update({ units: value }); setNumber(current => Math.min(current, value)); }} />
                <NumberSetting key={`${work.id}:words:${work.words_per_chapter}`} label={`每${unit}字数`} min={300} max={isNovel ? 6000 : 3000} value={work.words_per_chapter} disabled={busy} onChange={value => update({ words_per_chapter: value })} /></div>
              {([['genres', '题材（最多3项）', 3], ['core', '核心设定（最多3项）', 3], ['styles', '风格（最多5项）', 5]] as const).map(([key, label, max]) => <TagField key={key + work.id} label={label} value={work.creative?.[key] || (key === "genres" ? [work.genre] : [])} max={max} disabled={busy} onChange={tags => update({ creative: { ...work.creative, [key]: tags }, ...(key === "genres" && tags.length ? { genre: tags.join(" / ").slice(0, 80) } : {}) })} />)}
              <label>核心亮点<textarea rows={2} maxLength={5000} disabled={busy} value={work.creative?.highlights || ""} onChange={e => update({ creative: { ...work.creative, highlights: e.target.value } })} /></label>
              {work.creative?.source_text && <details><summary>改编／改写原始素材（保留原文）</summary><pre className="plotloom-pre">{work.creative.source_text}</pre></details>}
            </section>}
            <section className="editor-panel"><div className="editor-panel-heading"><div><h2>{labels[tab]}</h2><p>生成前保存当前编辑，结果审阅后采纳。</p></div><div className="studio-generate-controls">
              {tab === "chapter" && <select aria-label="正文目录" value={number} onChange={e => setNumber(Number(e.target.value))}>{Array.from({ length: work.units }, (_, i) => <option key={i} value={i + 1}>第{i + 1}{unit}{work.chapters.some(c => c.number === i + 1 && c.content) ? " · 已有正文" : ""}</option>)}</select>}
              <button className="pill light" disabled={busy || pending} onClick={() => void generate(tab)}>AI {text ? "重新生成" : "生成"}</button>
              {tab === "chapter" && text && <button className="outline-button" disabled={busy || pending} onClick={() => void generate("chapter", false, true)}>续写</button>}
            </div></div><textarea className="script-editor" aria-label={labels[tab]} disabled={busy} value={text} maxLength={tab === "chapter" ? 150000 : 50000} onChange={e => changeText(e.target.value)} placeholder={tab === "premise" ? "写下故事梗概：人物、愿望与核心冲突…" : "编辑或生成此步骤内容…"} /><div className="editor-bottom"><span>{text.length} 字</span><span>候选不会自动覆盖原稿</span></div></section>
            <div className="editor-next"><p className="studio-hint">{tab === "chapter" ? `已写 ${work.chapters.filter(c => c.content.trim()).length}/${work.units}${unit}，生成结果请在下方审阅采纳。` : "可手动编辑或采纳 AI 候选，保存后进入下一步。"}</p>
              {tab !== "chapter" ? <button className="outline-button" disabled={busy} onClick={async () => { if (await persist()) setTab(tab === "premise" ? "characters" : tab === "characters" ? "outline" : "chapter"); }}>保存并进入{tab === "premise" ? "人物" : tab === "characters" ? "大纲" : "正文"} →</button>
                : <div className="studio-generate-controls"><button className="outline-button" disabled={busy || number <= 1} onClick={async () => { if (await persist()) setNumber(n => Math.max(1, n - 1)); }}>上一{unit}</button><button className="outline-button" disabled={busy || number >= work.units} onClick={async () => { if (await persist()) setNumber(n => Math.min(work.units, n + 1)); }}>下一{unit}</button></div>}</div>
            <section className="studio-candidates"><div className="studio-section-bar"><h2>生成任务与候选稿</h2><button onClick={() => void refreshJobs().catch(e => setNotice(e instanceof Error ? e.message : "读取任务失败"))}>刷新任务</button></div>
              {legacyCandidates.length > 0 && <details className="studio-candidate"><summary>旧版创作候选（{legacyCandidates.length}）</summary>{legacyCandidates.map(c => <article className="plotloom-result" key={c.id}><h3>{labels[c.action]} · {c.status === "adopted" ? "已采纳" : c.status === "proposed" ? "待确认" : "已中断或失败"}</h3>{c.error && <p className="studio-error">{c.error}</p>}<pre className="plotloom-pre">{c.text}</pre><button className="outline-button" onClick={() => downloadText(`${work.title}-旧候选.txt`, c.text)}>导出旧候选</button>{c.status === "proposed" && <button className="pill light" disabled={busy || dirty} onClick={() => void adoptLegacy(c)}>采纳旧候选</button>}</article>)}</details>}
              {!jobs.length && <p className="studio-hint">尚无任务。可分步生成，也可一键生成设定、人物、大纲与全部正文。</p>}
              <div className="plotloom-job-list">{jobs.map(j => <button className={selectedJob?.id === j.id ? "active" : ""} key={j.id} onClick={() => { ++refreshSequence.current; setSelectedJob(j); }}>{jobStatus(j.status)} · {j.completed}/{j.total} 步</button>)}</div>
              {selectedJob && <article className="studio-candidate"><div className="studio-section-bar"><h3>{jobStatus(selectedJob.status)} · {selectedJob.completed}/{selectedJob.total} 步</h3><span>基于作品 v{selectedJob.base_revision}</span></div>
                <progress value={selectedJob.completed} max={selectedJob.total} aria-label="生成进度" /><p className="studio-hint">{labels[selectedJob.current.action as keyof typeof labels]}{selectedJob.current.action === "chapter" ? ` · 第${selectedJob.current.number}${unit}` : ""}。停止会等待当前请求结束并保存；已完成步骤不会重复生成。</p>
                {selectedJob.error && <p className="studio-error" role="alert">{selectedJob.error}</p>}
                <div className="studio-candidate-actions">{active.includes(selectedJob.status) && <button className="outline-button" onClick={() => void control(selectedJob, "stop")}>停止任务</button>}
                  {["failed", "stopped", "interrupted"].includes(selectedJob.status) && <button className="pill light" onClick={() => void control(selectedJob, "resume")}>从失败／未完成处继续</button>}
                  <button className="outline-button" onClick={async () => { try { downloadText(`${work.title}-生成稿.txt`, await api<string>(`/studio/jobs/${selectedJob.id}/export`)); } catch (e) { setNotice(String(e)); } }}>导出本次生成稿</button>
                  {selectedJob.status === "completed" && <button className="pill light" disabled={busy || dirty} onClick={() => void adopt()}>采纳整稿</button>}</div>
                {selectedJob.results?.map((r, i) => <details className="plotloom-result" key={i} open={selectedJob.results?.length === 1}><summary>{labels[r.action]}{r.action === "chapter" ? ` · 第${r.number}${unit}` : ""} · {r.adopted ? "已采纳" : "待确认"}</summary><pre className="plotloom-pre">{r.text}</pre>{r.references.length > 0 && <p className="studio-hint">参考：{r.references.map(x => x.title).join("、")}</p>}<button className="pill light" disabled={busy || dirty || r.adopted} onClick={() => void adopt(i)}>采纳此项</button></details>)}
              </article>}
            </section>
          </div>
          <aside className="plotloom-world"><button className="outline-button" onClick={() => setWorldOpen(!worldOpen)}>{worldOpen ? "收起" : "展开"}作品世界</button>{worldOpen && <div className="create-form"><h2>作品独立世界副本</h2><p className="studio-hint">修改仅影响当前作品。世界库原件和其他作品均保持独立。</p>
            <label>从世界库复制<select disabled={busy} value={work.world_id || ""} onChange={e => { const w = worlds.find(x => x.id === e.target.value); if (w) update({ world_id: w.id, world_snapshot: { name: w.name, description: w.description, sections: { ...w.sections } } }); }}><option value="">选择世界库原件</option>{worlds.map(w => <option value={w.id} key={w.id}>{w.name}</option>)}</select></label>
            {!world && <button className="pill light" disabled={busy} onClick={() => changeWorld({})}>新建作品专属世界</button>}
            {world && <><label>副本名称<input value={world.name} maxLength={80} disabled={busy} onChange={e => changeWorld({ name: e.target.value })} /></label><label>概述<textarea rows={3} value={world.description} maxLength={5000} disabled={busy} onChange={e => changeWorld({ description: e.target.value })} /></label>
              {status?.world_sections.map(s => <details key={s.id}><summary>{s.label}</summary>{s.fields.map(f => <label key={f.key}>{f.label}<textarea disabled={busy} rows={4} maxLength={20000} value={world.sections[f.key] || ""} onChange={e => changeWorld({ sections: { ...world.sections, [f.key]: e.target.value } })} /></label>)}</details>)}
              <button className="outline-button" disabled={busy} onClick={() => void saveWorldLibrary()}>另存世界库新条目</button><button className="outline-button" onClick={() => void exportWorld()}>导出副本</button></>}
            <button className="pill light" disabled={busy || pending} onClick={() => void generate("world")}>AI 辅助完善（先审阅）</button><Link href="/worlds">管理世界库原件 →</Link>
          </div>}</aside>
        </div>
      </>}
    </main></div></div>;
}

function jobStatus(status: string) {
  return ({ queued: "排队中", running: "生成中", stopping: "停止中", stopped: "已停止", failed: "失败", interrupted: "重启中断", completed: "生成完成" } as Record<string, string>)[status] || status;
}

function NumberSetting({ label, value, min, max, disabled, onChange }: {
  label: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void;
}) {
  const [input, setInput] = useState(String(value));
  const [error, setError] = useState("");
  function commit() {
    const next = Number(input);
    if (!Number.isInteger(next) || next < min || next > max) {
      setError(`请输入${min}至${max}的整数${min > 1 && max === 200 ? "，已有正文的编号须保留" : ""}`); return;
    }
    setError(""); if (next !== value) onChange(next);
  }
  return <label>{label}<input type="number" min={min} max={max} value={input} disabled={disabled} onChange={e => setInput(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />{error && <span className="studio-error" role="alert">{error}</span>}</label>;
}

function TagField({ label, value, max, disabled, onChange }: { label: string; value: string[]; max: number; disabled: boolean; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  function add() {
    const tags = [...new Set([...value, ...input.split(/[,，]/).map(s => s.trim()).filter(Boolean)])];
    if (tags.length > max || tags.some(s => s.length > 80)) { setError(`最多${max}项，每项不超过80字`); return; }
    onChange(tags); setInput(""); setError("");
  }
  return <div className="plotloom-tags"><span>{label}</span><div>{value.map(t => <button key={t} disabled={disabled} aria-label={`移除${t}`} onClick={() => onChange(value.filter(x => x !== t))}>{t} ×</button>)}</div><input value={input} disabled={disabled} placeholder="输入自定义标签，回车添加" maxLength={400} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={() => { if (input.trim()) add(); }} />{error && <p role="alert" className="studio-error">{error}</p>}</div>;
}
