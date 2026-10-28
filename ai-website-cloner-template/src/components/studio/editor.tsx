"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RotateCcw, RotateCw, Settings, Sparkles } from "lucide-react";
import { backendRequest as api, jsonBody, workPayload, downloadText, localExport, unitLabel,
  type Work, type WorkInput, type World, type StudioStatus, type Action, type Reference, type WorldInput, type Candidate } from "@/lib/studio/api";
import { WorkForm } from "./work-form";
import { ProjectShell, ProjectTitle, ProjectToolbar } from "./project-shell";
import { ProjectSettings } from "./project-settings";
import { OutlineEditor } from "./outline-editor";
import { ManuscriptEditor } from "./manuscript-editor";
import { Inspiration } from "./inspiration";
import { useEditHistory } from "./edit-history";
import { projectNumbers, settingsPatch, type ProjectSettingsValue } from "@/lib/studio/project";
import { exportWord } from "@/lib/studio/word-export";
import { worldDraftChecksum } from "@/lib/studio/world-codec";
import { creationMode } from "@/lib/studio/writing";
import { revealWritingStage } from "./workflow-nav";
import { CharacterEditor } from "./character-editor";
import { writingDestination, writingLabels, workEditorUrl } from "@/lib/studio/workflow";
import styles from "./integration.module.css";

type Result = { action: Action | "world"; number: number; text: string; adopted: boolean; references: Reference[] };
type Job = { id: string; status: string; completed: number; total: number; error: string;
  current: { action: string; number: number }; results?: Result[]; base_revision: number };
const baseLabels = { premise: "故事设定", characters: "人物小传", outline: "大纲", chapter: "正文", world: "作品世界" };
const active = ["queued", "running", "stopping"];

export function StudioEditor({ id, kind = "short_drama", mode, referenceId = "", sampleId, sampleInput }: {
  id?: string; kind?: "short_drama" | "novel"; mode?: string; referenceId?: string; sampleId?: string; sampleInput?: WorkInput;
}) {
  const router = useRouter();
  const history = useEditHistory<WorkInput>();
  const [inspiration, setInspiration] = useState(false);
  const [settingsBackup, setSettingsBackup] = useState<Partial<Work>>();
  const [numericInput, setNumericInput] = useState<{units?: string; words_per_chapter?: string}>({});
  const [wordOpen, setWordOpen] = useState(false);
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
  const [recovery, setRecovery] = useState("");
  const mutating = useRef(false);
  const requestKey = useRef("");
  const refreshSequence = useRef(0);
  const creation = creationMode(kind, mode);
  const isNovel = (work?.content_type || kind) === "novel";
  const labels = { ...baseLabels, ...writingLabels(work?.content_type || kind) };

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
      const destination = writingDestination(window.location.search);
      setTab(destination.step); setNumber(Math.min(destination.number, value.units));
      if (new URLSearchParams(window.location.search).get("notice") === "generation-unconfirmed") setNotice("草稿及全部输入已保存，生成请求尚未确认成功。请先查看任务列表，再决定是否手动生成。");
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

  const update = (patch: Partial<Work>, record = true) => {
    if (!work || mutating.current) return;
    if (record) history.record(workPayload(work));
    const next = { ...work, ...patch };
    setWork(next); setDirty(true);
    try { localStorage.setItem(`plotloom-unsaved-${work.id}`, JSON.stringify(next)); }
    catch { setNotice("浏览器草稿备份不可用，请手动保存或导出。"); }
  };

  const persist = useCallback(async (): Promise<Work | null> => {
    if (!work) return null;
    try { projectNumbers(work,numericInput); } catch (cause) { setNotice(cause instanceof Error ? cause.message : "参数无效"); return null; }
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
  }, [work, dirty, numericInput]);

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
    if (action === "chapter" && (!Number.isInteger(number) || number < 1 || number > saved.units)) { setNotice("请选择计划范围内的正文编号后再生成。"); return; }
    mutating.current = true; setBusy(true);
    try {
      // Keep the same key after an uncertain network response. Editing the work
      // produces another revision and therefore another request identity.
      const targetNumber = action === "chapter" ? number : 1;
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
      history.clear(); setNumericInput({}); setWork(saved); setDirty(false); setNotice("已采纳并保存"); await refreshJobs();
    } catch (e) { setNotice(e instanceof Error ? e.message : "采纳失败"); }
    finally { mutating.current = false; setBusy(false); }
  }

  async function adoptLegacy(candidate: Candidate) {
    if (!work || busy || dirty || mutating.current) return;
    mutating.current = true; setBusy(true);
    try {
      const saved = await api<Work>(`/studio/works/${work.id}/candidates/${candidate.id}/adopt`, { method: "POST", body: "{}" });
      history.clear(); setNumericInput({}); setWork(saved); setDirty(false); setNotice("旧版候选已采纳并保存");
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
  function changeWorld(patch: Partial<WorldInput>) {
    update({ world_snapshot: { name: world?.name || "作品专属世界", description: world?.description || "", sections: world?.sections || {}, ...patch } });
  }

  function changeSettings(patch: Partial<ProjectSettingsValue>) {
    if (!work || busy) return;
    const { units, words_per_chapter, ...other } = patch;
    const raw = { ...numericInput, ...(units !== undefined ? {units:String(units)} : {}), ...(words_per_chapter !== undefined ? {words_per_chapter:String(words_per_chapter)} : {}) };
    if (units !== undefined || words_per_chapter !== undefined) setNumericInput(raw);
    const next: Partial<Work> = { ...other };
    try { const numbers = projectNumbers(work,raw); Object.assign(next,numbers); if (units !== undefined) setNumber(current => Math.min(current,numbers.units)); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "参数无效"); if (!Object.keys(other).length) return; }
    if (patch.creative?.genres?.length) next.genre = patch.creative.genres.join(" / ").slice(0,80);
    update(next);
  }
  function applySettings(analysis: WorkInput) {
    if (!work || busy || mutating.current) return;
    try {
      const patch = settingsPatch(work,analysis);
      setSettingsBackup({...settingsPatch(work,workPayload(work)),world_id:work.world_id});
      setNumericInput({}); setNumber(current => Math.min(current,analysis.units)); update(patch); setInspiration(false); setNotice("灵感方案已回填，人物、大纲和正文保留。请检查设定后继续创作。");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "回填失败"); }
  }
  const worldControls = work && <div className={`create-form ${styles.worldArea}`}>
            <label>从世界库复制<select disabled={busy} value={work.world_id || ""} onChange={e => { const w = worlds.find(x => x.id === e.target.value); if (w) update({ world_id: w.id, world_snapshot: { name: w.name, description: w.description, sections: { ...w.sections } } }); }}><option value="">选择世界库原件</option>{worlds.map(w => <option value={w.id} key={w.id}>{w.name}</option>)}</select></label>
            {!world && <button className="pill light" disabled={busy} onClick={() => changeWorld({})}>新建作品专属世界</button>}
            {world && <><label>副本名称<input value={world.name} maxLength={80} disabled={busy} onChange={e => changeWorld({ name: e.target.value })} /></label><label>概述<textarea rows={3} value={world.description} maxLength={5000} disabled={busy} onChange={e => changeWorld({ description: e.target.value })} /></label>
              {status?.world_sections.map(s => <details key={s.id}><summary>{s.label}</summary>{s.fields.map(f => <label key={f.key}>{f.label}<textarea disabled={busy} rows={4} maxLength={20000} value={world.sections[f.key] || ""} onChange={e => changeWorld({ sections: { ...world.sections, [f.key]: e.target.value } })} /></label>)}</details>)}
              <button className="outline-button" disabled={busy} onClick={() => void saveWorldLibrary()}>另存世界库新条目</button><button className="outline-button" onClick={() => void exportWorld()}>导出副本</button></>}
            <button className="pill light" disabled={busy || pending} onClick={() => void generate("world")}>AI 辅助完善（先审阅）</button><Link href="/worlds">管理世界库原件 →</Link>

  </div>;
  return <ProjectShell><div onClickCapture={e => {
    if ((dirty || busy) && e.target instanceof Element && e.target.closest("a")) { e.preventDefault(); e.stopPropagation(); setNotice("请先保存或导出当前编辑后离开。"); }
  }}>
      {error && <div className={styles.notice}><p className="studio-error" role="alert">{error}<button onClick={() => window.location.reload()}>重新加载</button></p></div>}
      {notice && notice !== "已保存" && <div className={styles.notice}><p className="studio-inline-notice" role="status">{notice}</p></div>}
      {recovery && <div className={styles.notice}><button className={styles.tool} onClick={() => downloadText("旧版本本地编辑.json", recovery)}>导出待核对的本地编辑</button></div>}
      {!id && !referenceReady ? <p className={styles.workspace} role="status">{error ? "参考资料读取失败，请重新加载。" : "正在读取参考资料…"}</p> : !id ? <WorkForm key={`${kind}:${creation}:${reference?.id}:${sampleId || ""}`} kind={kind} mode={creation} worlds={worlds} sections={status?.world_sections} reference={reference} sampleId={sampleId} sampleInput={sampleInput} onClose={() => router.push("/workspace")} onCreated={(value, intent, warning) => {
          if (warning) try { localStorage.setItem(`plotloom-create-warning-${value.id}`, warning); } catch { /* Saved work remains available. */ }
          router.push(`${workEditorUrl(value.id, intent)}${warning ? "&notice=generation-unconfirmed" : ""}`);
        }} /> : !work ? <p className={styles.workspace}>正在读取作品…</p> : <>
        <ProjectTitle type={work.content_type} title={work.title} disabled={busy} onChange={title => update({ title })} actions={<div className={styles.utility}><span className={styles.saveState}>{busy ? "处理中…" : blocked ? "保存失败" : dirty ? "等待自动保存" : "已保存"}</span><button type="button" onClick={() => downloadText(`${work.title}.txt`,localExport(work))}>导出 TXT</button><button type="button" onClick={() => downloadText(`${work.title}.json`,jsonBody({schema:"plotloom.work",version:1,work:workPayload(work)}),"application/json")}>完整备份</button><button type="button" disabled={busy} onClick={() => void persist()}>保存</button><button type="button" disabled={busy || pending} onClick={() => void generate("premise",true)}>一键生成全部 {work.units}{unit}</button></div>} />
        <ProjectToolbar type={work.content_type} current={tab} value={work} disabled={busy} onSelect={step => { setTab(step); window.history.replaceState(null,"",workEditorUrl(work.id,{step,number})); }} actions={<>
          <div className={styles.history}><button type="button" title="撤销" aria-label="撤销" disabled={busy || !history.canUndo} onClick={() => { setNumericInput({}); history.undo(workPayload(work),value => update(value,false)); }}><RotateCcw size={20} /></button><button type="button" title="重做" aria-label="重做" disabled={busy || !history.canRedo} onClick={() => { setNumericInput({}); history.redo(workPayload(work),value => update(value,false)); }}><RotateCw size={20} /></button></div>
          {tab === "premise" ? <button type="button" className={`${styles.primary} ${styles.inspiration}`} disabled={busy || pending} onClick={() => setInspiration(true)}><Sparkles size={17} />灵感创作</button> : <>
            {tab === "chapter" && <><button type="button" className={styles.tool} onClick={() => exportWord(work.title,work.chapters)}><Download size={17} />导出为Word</button><button type="button" className={styles.tool} onClick={() => setWordOpen(!wordOpen)}><Settings size={17} />正文字数</button></>}
            <button type="button" className={styles.primary} disabled={busy || pending} onClick={() => void generate(tab)}><Sparkles size={17} />AI 生成{labels[tab]}</button>
          </>}
        </>} />
        <main className={styles.workspace}>
          {settingsBackup && tab === "premise" && <button type="button" className="text-button" disabled={busy} onClick={() => { setNumericInput({}); update(settingsBackup); setSettingsBackup(undefined); setNotice("已恢复灵感回填前的设定。"); }}>恢复回填前的设定</button>}
          {wordOpen && tab === "chapter" && <div className={styles.wordControls}><NumberSetting key={`${work.id}:${work.words_per_chapter}`} label={`每${unit}目标字数`} value={work.words_per_chapter} min={300} max={isNovel ? 6000 : 3000} disabled={busy} onChange={value => { setNumericInput(current => ({...current,words_per_chapter:String(value)})); update({words_per_chapter:value}); }} /></div>}
          <div id="writing-stage-panel" role="tabpanel" aria-labelledby={`writing-tab-${tab}`} className={styles.stage}>
            {tab === "premise" && <ProjectSettings type={work.content_type} value={{...work,...numericInput}} disabled={busy} onChange={changeSettings}>{worldControls}{work.creative?.source_text && <details><summary>改编／改写原始素材</summary><pre className="plotloom-pre">{work.creative.source_text}</pre></details>}</ProjectSettings>}
            {tab === "characters" && <CharacterEditor value={work.characters} disabled={busy} onChange={characters => update({characters})} onGenerate={() => void generate("characters")} generating={pending} />}
            {tab === "outline" && <OutlineEditor value={work.outline} type={work.content_type} units={work.units} disabled={busy} onChange={outline => update({outline})} />}
            {tab === "chapter" && <ManuscriptEditor type={work.content_type} chapters={work.chapters} units={work.units} number={number} disabled={busy} generating={pending} onNumber={next => { setNumber(next); window.history.replaceState(null,"",workEditorUrl(work.id,{step:"chapter",number:next})); }} onChange={chapters => update({chapters})} onGenerate={() => void generate("chapter")} onContinue={() => void generate("chapter",false,true)} />}
          </div>
          {tab !== "premise" && <details className={styles.supplement}><summary>作品世界</summary>{worldControls}</details>}
          <div className={styles.bottom}><p>原稿保留 · AI生成结果请在候选区审阅采纳</p>{tab !== "chapter" && <button type="button" className={styles.tool} disabled={busy} onClick={async () => { if (await persist()) { const next = tab === "premise" ? "characters" : tab === "characters" ? "outline" : "chapter"; setTab(next); window.history.replaceState(null,"",workEditorUrl(work.id,{step:next,number})); revealWritingStage(); } }}>保存并进入{tab === "premise" ? "人物" : tab === "characters" ? "大纲" : "正文"} →</button>}</div>
            <details className={styles.candidates} open={pending || !!selectedJob?.results?.some(result => !result.adopted)}><summary>生成任务与候选稿{pending ? " · 生成处理中" : ""}</summary><section className="studio-candidates"><div className="studio-section-bar"><h2>生成任务与候选稿</h2><button onClick={() => void refreshJobs().catch(e => setNotice(e instanceof Error ? e.message : "读取任务失败"))}>刷新任务</button></div>
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
            </section></details>
        </main>
        {inspiration && <Inspiration type={work.content_type} initialPrompt={work.premise} onApply={applySettings} onClose={() => setInspiration(false)} />}
      </>}
  </div></ProjectShell>;
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
