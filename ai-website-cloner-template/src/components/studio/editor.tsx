"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RotateCcw, RotateCw, Settings, Sparkles } from "lucide-react";
import { backendRequest as api, jsonBody, workPayload, downloadText, localExport, unitLabel,
  type Work, type WorkInput, type World, type StudioStatus, type Action, type Reference, type WorldInput } from "@/lib/studio/api";
import { WorkForm } from "./work-form";
import { Header } from "@/components/sites/storyplay/shared";
import { StudioNav } from "./navigation";
import { ProjectShell, ProjectTitle, ProjectToolbar } from "./project-shell";
import { ProjectSettings } from "./project-settings";
import { ProjectParameters } from "./project-parameters";
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
import { writingDestination, writingLabels, editorLabels, nextEditorStep, workEditorUrl, type EditorStep } from "@/lib/studio/workflow";
import { activeGeneration, canFillGeneration, generationSignature, latestGeneration, pendingResults, previewGeneration, outlineStreamPreview, type GenerationResult } from "@/lib/studio/inline-generation";
import styles from "./integration.module.css";

type Result = { action: Action | "world"; number: number; text: string; adopted: boolean; references: Reference[]; world?: WorldInput };
type Job = { id: string; status: string; completed: number; total: number; error: string;
  current: { action: string; number: number }; results?: Result[]; partial_outline?: string; base_revision: number; adoption_revision?: number; mode: "single" | "all" };
const baseLabels = { premise: "故事设定", characters: "人物小传", outline: "大纲", chapter: "正文", world: "作品世界" };
const active = activeGeneration;

export function StudioEditor({ id, kind = "short_drama", mode, referenceId = "", sampleId, sampleInput }: {
  id?: string; kind?: "short_drama" | "novel"; mode?: string; referenceId?: string; sampleId?: string; sampleInput?: WorkInput;
}) {
  const router = useRouter();
  const history = useEditHistory<WorkInput>();
  const recordSnapshot = useRef(history.record);
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
  const [tab, setTab] = useState<EditorStep>("premise");
  const [number, setNumber] = useState(1);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job>();
  const [recovery, setRecovery] = useState("");
  const mutating = useRef(false);
  const requestKey = useRef("");
  const refreshSequence = useRef(0);
  const generationAttempts = useRef(new Set<string>());
  const [generationError, setGenerationError] = useState<{ signature: string; message: string }>();
  const [preview, setPreview] = useState<GenerationResult>();
  const [filled, setFilled] = useState<Record<Action, number>>({ premise: 0, characters: 0, outline: 0, chapter: 0 });
  const creation = creationMode(kind, mode);
  const isNovel = (work?.content_type || kind) === "novel";
  const labels = { ...baseLabels, ...writingLabels(work?.content_type || kind) };
  const viewLabels = editorLabels(work?.content_type || kind);
  const nextStep = nextEditorStep(tab);

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
    if (id) void api<Work>(`/studio/works/${id}`, { signal }).then(value => {
      if (signal.aborted) return;
      setWork(value);
      const destination = writingDestination(window.location.search);
      setTab(destination.step); setNumber(Math.min(destination.number, value.units));
      if (new URLSearchParams(window.location.search).get("notice") === "generation-unconfirmed") setNotice("草稿及全部输入已保存，生成请求尚未确认成功。可在当前步骤查看进度或重新打开作品核对。");
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

  const refreshJobs = useCallback(async (signal?: AbortSignal) => {
    if (!id) return;
    const sequence = ++refreshSequence.current;
    const data = await api<{ items: Job[] }>(`/studio/works/${id}/jobs`, { signal });
    if (signal?.aborted || sequence !== refreshSequence.current) return;
    const target = latestGeneration(data.items, tab, number)?.id || data.items[0]?.id;
    const detail = target ? await api<Job>(`/studio/jobs/${target}`, { signal }) : undefined;
    if (signal?.aborted || sequence !== refreshSequence.current) return;
    setJobs(data.items);
    if (detail) setSelectedJob(previous => previous?.id === detail.id && (previous.adoption_revision ?? previous.base_revision) > (detail.adoption_revision ?? detail.base_revision) ? previous : detail);
    // A lost adoption response must not leave the editor empty after the server
    // already committed. Re-read saved content without repeating the mutation.
    if (detail && work && !dirty && !mutating.current && (detail.adoption_revision ?? detail.base_revision) > work.revision) {
      const saved = await api<Work>(`/studio/works/${id}`, { signal });
      if (signal?.aborted || sequence !== refreshSequence.current || mutating.current) return;
      recordSnapshot.current(workPayload(work));
      setWork(saved); setBlocked(false); setGenerationError(undefined);
      setFilled(current => ({ premise: current.premise + 1, characters: current.characters + 1, outline: current.outline + 1, chapter: current.chapter + 1 }));
    }
  }, [id, tab, number, work, dirty]);
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

  // Every committed result enters its real editor, including partial all-step jobs.
  // The server batches available results and atomically verifies adoption_revision.
  useEffect(() => {
    const signature = generationSignature(selectedJob);
    if (!work || busy || mutating.current || !selectedJob || generationAttempts.current.has(signature) ||
        !canFillGeneration(selectedJob, work, dirty)) return;
    generationAttempts.current.add(signature);
    mutating.current = true;
    const ready = pendingResults(selectedJob);
    void Promise.resolve().then(async () => {
      setBusy(true); setGenerationError(undefined);
      try {
        const saved = await api<Work>(`/studio/jobs/${selectedJob.id}/adopt`, { method: "POST", body: jsonBody({ ready_only: true }) });
        if (saved.revision > work.revision) history.record(workPayload(work));
        setWork(saved); setDirty(false); setBlocked(false); setPreview(undefined); setNotice("");
        setFilled(current => {
          const next = { ...current };
          for (const action of new Set(ready.map(result => result.action))) if (action !== "world") next[action]++;
          return next;
        });
        setSelectedJob({ ...selectedJob, adoption_revision: saved.revision, results: selectedJob.results?.map(result => ready.includes(result) ? { ...result, adopted: true } : result) });
      } catch (cause) {
        setGenerationError({ signature, message: cause instanceof Error ? cause.message : "生成内容回填未确认，请刷新核对；原稿和生成稿均保留。" });
      } finally { mutating.current = false; setBusy(false); }
    });
  }, [work, busy, selectedJob, dirty, history]);

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
      setNotice(""); setPreview(undefined); setGenerationError(undefined);
      setJobs((await api<{ items: Job[] }>(`/studio/works/${saved.id}/jobs`)).items);
      requestKey.current = "";
    } catch (e) { setNotice(e instanceof Error ? e.message : "提交未确认，请刷新当前步骤核对。"); }
    finally { mutating.current = false; setBusy(false); }
  }

  async function control(job: Job, action: "stop" | "resume") {
    try { await api(`/studio/jobs/${job.id}/${action}`, { method: "POST", body: "{}" }); await refreshJobs(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "操作失败"); }
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
  const pending = jobs.some(job => active.includes(job.status));
  const ready = pendingResults(selectedJob);
  const signature = generationSignature(selectedJob);
  const fillError = generationError?.signature === signature ? generationError.message : "";
  const conflict = ready.length > 0 && (!!fillError || !!work && !canFillGeneration(selectedJob, work, dirty));
  const previewResult = preview && ready.find(result => result.action === preview.action && result.number === preview.number && result.text === preview.text);
  const shownWork = work && previewResult ? previewGeneration(work, previewResult) : work;
  const editingDisabled = busy || !!previewResult;

  function showGenerated() {
    const result = ready.find(item => item.action === (tab === "settings" ? "world" : tab) && (tab !== "chapter" || item.number === number)) || ready[0];
    if (!result || !work) return;
    const step = result.action === "world" ? "settings" : result.action;
    const targetNumber = result.action === "chapter" ? result.number : number;
    setPreview(result); setTab(step); setNumber(targetNumber);
    window.history.replaceState(null, "", workEditorUrl(work.id, { step, number: targetNumber }));
    revealWritingStage();
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
  return <div className="workspace-page" onClickCapture={event => {
    if ((dirty || busy) && event.target instanceof Element && event.target.closest("a")) { event.preventDefault(); event.stopPropagation(); setNotice("请先保存或导出当前编辑后离开。"); }
  }}>
    <Header workspace />
    <div className="plotloom-shell">
      <StudioNav selected={isNovel ? "小说创作" : "剧本创作"} />
      <div className={styles.editorPane}><ProjectShell>
        {error && <p className={styles.inlineMessage} role="alert">{error}<button type="button" onClick={() => window.location.reload()}>重新加载</button></p>}
        {recovery && <div className={styles.inlineMessage}><button type="button" onClick={() => downloadText("旧版本本地编辑.json", recovery)}>导出待核对的本地编辑</button></div>}
        {!id && !referenceReady ? <p className={styles.workspace} role="status">{error ? "参考资料读取失败，请重新加载。" : "正在读取参考资料…"}</p> : !id ? <WorkForm key={`${kind}:${creation}:${reference?.id}:${sampleId || ""}`} kind={kind} mode={creation} worlds={worlds} sections={status?.world_sections} reference={reference} sampleId={sampleId} sampleInput={sampleInput} onClose={() => router.push("/workspace")} onCreated={(value, intent, warning) => {
          if (warning) try { localStorage.setItem(`plotloom-create-warning-${value.id}`, warning); } catch { /* Saved work remains available. */ }
          router.push(`${workEditorUrl(value.id, intent)}${warning ? "&notice=generation-unconfirmed" : ""}`);
        }} /> : !work || !shownWork ? <p className={styles.workspace}>正在读取作品…</p> : <>
          <ProjectTitle type={work.content_type} title={work.title} disabled={editingDisabled} onChange={title => update({ title })} actions={<div className={styles.utility}>
            <span className={styles.saveState}>{busy ? "处理中…" : blocked ? "保存失败" : dirty ? "等待自动保存" : "已保存"}</span>
            <button type="button" onClick={() => downloadText(`${work.title}.txt`, localExport(work))}>导出 TXT</button>
            <button type="button" onClick={() => downloadText(`${work.title}.json`, jsonBody({ schema: "plotloom.work", version: 1, work: workPayload(work) }), "application/json")}>完整备份</button>
            <button type="button" disabled={editingDisabled} onClick={() => void persist()}>保存</button>
            <button type="button" disabled={editingDisabled || pending} onClick={() => void generate("premise", true)}>一键生成全部 {work.units}{unit}</button>
          </div>} />
          <ProjectToolbar type={work.content_type} current={tab} value={work} disabled={busy} onSelect={step => { setPreview(undefined); setTab(step); window.history.replaceState(null, "", workEditorUrl(work.id, { step, number })); }} actions={<>
            <div className={styles.history}>
              <button type="button" title="撤销" aria-label="撤销" disabled={editingDisabled || !history.canUndo} onClick={() => { setNumericInput({}); history.undo(workPayload(work), value => update(value, false)); }}><RotateCcw size={20} /></button>
              <button type="button" title="重做" aria-label="重做" disabled={editingDisabled || !history.canRedo} onClick={() => { setNumericInput({}); history.redo(workPayload(work), value => update(value, false)); }}><RotateCw size={20} /></button>
            </div>
            {tab === "premise" && <button type="button" className={`${styles.primary} ${styles.inspiration}`} disabled={editingDisabled || pending} onClick={() => setInspiration(true)}><Sparkles size={17} />灵感创作</button>}
            {tab === "chapter" && <><button type="button" className={styles.tool} onClick={() => exportWord(work.title, shownWork.chapters)}><Download size={17} />导出为Word</button><button type="button" className={styles.tool} onClick={() => setWordOpen(!wordOpen)}><Settings size={17} />正文字数</button></>}
            <button type="button" className={styles.primary} disabled={editingDisabled || pending} onClick={() => void generate(tab === "settings" ? "world" : tab)}><Sparkles size={17} />{tab === "settings" ? "AI 完善世界" : `AI 生成${tab === "premise" ? "故事梗概" : labels[tab]}`}</button>
          </>} />
          <main className={styles.workspace}>
            {notice && notice !== "已保存" && <p className={styles.inlineMessage} role="status">{notice}</p>}
            {selectedJob && (active.includes(selectedJob.status) || ["failed", "stopped", "interrupted"].includes(selectedJob.status) || conflict) && <div className={styles.generationStatus} role="status">
              {active.includes(selectedJob.status) ? <><span>{selectedJob.mode === "all" ? `全部生成 ${selectedJob.completed}/${selectedJob.total} · ` : ""}{labels[selectedJob.current.action as keyof typeof labels]}{selectedJob.current.action === "chapter" ? ` · 第${selectedJob.current.number}${unit}` : ""} · {selectedJob.status === "queued" ? "排队中" : selectedJob.status === "stopping" ? "正在停止" : "生成中"}</span><button type="button" onClick={() => void control(selectedJob, "stop")}>停止</button></> : ["failed", "stopped", "interrupted"].includes(selectedJob.status) ? <><span>{selectedJob.error || "生成已停止，已完成内容保留。"}</span><button type="button" onClick={() => void control(selectedJob, "resume")}>继续生成</button></> : null}
              {conflict && <><span>{fillError || "生成期间内容有修改，当前编辑已保留。"}</span><button type="button" onClick={() => previewResult ? setPreview(undefined) : showGenerated()}>{previewResult ? "返回当前内容" : "查看生成稿"}</button><button type="button" onClick={() => downloadText(`${work.title}-生成稿.txt`, ready.map(result => result.text).join("\n\n"))}>导出生成稿</button>{fillError && <button type="button" onClick={() => window.location.reload()}>刷新核对</button>}</>}
            </div>}
            {settingsBackup && tab === "premise" && <button type="button" className="text-button" disabled={editingDisabled} onClick={() => { setNumericInput({}); update(settingsBackup); setSettingsBackup(undefined); setNotice("已恢复灵感回填前的设定。"); }}>恢复回填前的设定</button>}
            {wordOpen && tab === "chapter" && <div className={styles.wordControls}><NumberSetting key={`${work.id}:${work.words_per_chapter}`} label={`每${unit}目标字数`} value={work.words_per_chapter} min={300} max={isNovel ? 6000 : 3000} disabled={editingDisabled} onChange={value => { setNumericInput(current => ({ ...current, words_per_chapter: String(value) })); update({ words_per_chapter: value }); }} /></div>}
            <div id="writing-stage-panel" role="tabpanel" aria-labelledby={`writing-tab-${tab}`} className={styles.stage}>
              {tab === "premise" && <ProjectSettings type={work.content_type} value={shownWork} disabled={editingDisabled} onChange={changeSettings}>{work.creative?.source_text && <details><summary>改编／改写原始素材</summary><pre className="plotloom-pre">{work.creative.source_text}</pre></details>}</ProjectSettings>}
              {tab === "settings" && <ProjectParameters type={work.content_type} value={previewResult ? shownWork : { ...work, ...numericInput }} worlds={worlds} sections={status?.world_sections} worldId={previewResult ? null : work.world_id} disabled={editingDisabled} onChange={changeSettings} onWorldChange={(world, sourceId) => update({ world_snapshot: world, world_id: sourceId || null })} onSaveWorld={previewResult ? undefined : () => void saveWorldLibrary()} onExportWorld={previewResult ? undefined : () => void exportWorld()} />}
              {tab === "characters" && <CharacterEditor key={`${filled.characters}:${!!previewResult}`} value={shownWork.characters} disabled={busy} readOnly={!!previewResult} onChange={characters => update({ characters })} onGenerate={() => void generate("characters")} generating={pending} />}
              {tab === "outline" && <OutlineEditor key={`${filled.outline}:${!!previewResult}`} value={shownWork.outline} type={work.content_type} units={work.units} roughPreview={previewResult ? undefined : outlineStreamPreview(selectedJob, work, dirty)} disabled={editingDisabled} onChange={outline => update({ outline })} />}
              {tab === "chapter" && <ManuscriptEditor type={work.content_type} chapters={shownWork.chapters} units={work.units} number={number} disabled={editingDisabled} generating={pending} onNumber={next => { setPreview(undefined); setNumber(next); window.history.replaceState(null, "", workEditorUrl(work.id, { step: "chapter", number: next })); }} onChange={chapters => update({ chapters })} onGenerate={() => void generate("chapter")} onContinue={() => void generate("chapter", false, true)} />}
            </div>
            {nextStep && <div className={styles.bottom}><button type="button" className={styles.tool} disabled={editingDisabled} onClick={async () => { if (await persist()) { setTab(nextStep); window.history.replaceState(null, "", workEditorUrl(work.id, { step: nextStep, number })); revealWritingStage(); } }}>保存并进入{viewLabels[nextStep]} →</button></div>}
          </main>
          {inspiration && <Inspiration type={work.content_type} initialPrompt={work.premise} onApply={applySettings} onClose={() => setInspiration(false)} />}
        </>}
      </ProjectShell></div>
    </div>
  </div>;
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
