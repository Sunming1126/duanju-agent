"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, RotateCcw, RotateCw, Sparkles } from "lucide-react";
import { jsonBody, downloadText, type ContentType, type Reference, type Section, type Work, type World, type WorkInput } from "@/lib/studio/api";
import { createWorkForStep } from "@/lib/studio/creation";
import { applyInspiration, creationPayload, initialCreationDraft, type CreationDraft } from "@/lib/studio/inspiration";
import { Inspiration } from "./inspiration";
import { ProjectTitle, ProjectToolbar } from "./project-shell";
import { ProjectSettings } from "./project-settings";
import { ProjectParameters } from "./project-parameters";
import { OutlineEditor } from "./outline-editor";
import { ManuscriptEditor } from "./manuscript-editor";
import { useEditHistory } from "./edit-history";
import { applyProjectSettings, projectSettingsFromDraft } from "@/lib/studio/project";
import { exportWord } from "@/lib/studio/word-export";
import { creationDraftKeys } from "@/lib/studio/writing";
import { editorLabels, editorSteps, nextEditorStep, type CreationIntent } from "@/lib/studio/workflow";
import { revealWritingStage } from "./workflow-nav";
import { CharacterEditor } from "./character-editor";
import styles from "./integration.module.css";

export function WorkForm({ mode, kind, worlds, reference, sections = [], sampleId, sampleInput, onCreated, onClose }: {
  mode: string; kind?: ContentType; worlds: World[]; reference?: Reference; sections?: Section[];
  sampleId?: string; sampleInput?: WorkInput;
  onCreated: (work: Work, intent: CreationIntent, warning: string) => void | Promise<void>; onClose: () => void;
}) {
  const history = useEditHistory<CreationDraft>();
  const formRef = useRef<HTMLFormElement>(null);
  const generateRef = useRef<HTMLButtonElement>(null);
  const initialType: ContentType = kind || reference?.content_type || (mode === "小说创作" ? "novel" : "short_drama");
  const [draft, setDraft] = useState(() => {
    const initial = initialCreationDraft(initialType, reference);
    return sampleInput ? applyInspiration(initial, sampleInput) : initial;
  });
  const [inspiration, setInspiration] = useState(mode === "灵感策划" || mode === "灵感创作");
  const [backup, setBackup] = useState<CreationDraft>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [cacheError, setCacheError] = useState(false);
  const [otherTypeDraft, setOtherTypeDraft] = useState("");
  const lock = useRef(false);
  const created = useRef<Work | null>(null);
  const snapshotRef = useRef(draft);
  const restoredKey = useRef("");
  const draftSourceId = sampleId ? `official-${sampleId}` : reference?.id;
  const storageKey = `plotloom-new-${initialType}-${mode}-${draftSourceId || "original"}`;

  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(() => {
      if (disposed) return;
      try {
        const sourceKey = creationDraftKeys(initialType, mode, draftSourceId).find(key => localStorage.getItem(key)) || storageKey;
        const raw = localStorage.getItem(sourceKey);
        if (raw) {
          const cached = JSON.parse(raw) as CreationDraft;
          if (cached.content_type === initialType && typeof cached.premise === "string" && typeof cached.title === "string") {
            restoredKey.current = sourceKey;
            setDraft({ ...initialCreationDraft(initialType, reference), ...cached });
          } else if (["novel", "short_drama"].includes(cached.content_type)) {
            localStorage.setItem(`${storageKey}-other-type`, raw); setOtherTypeDraft(raw);
            setNotice("旧版草稿类型与当前入口不同，已保留备份；本页按当前入口创建作品。");
          }
        }
        const otherDraft = localStorage.getItem(`${storageKey}-other-type`);
        if (otherDraft) setOtherTypeDraft(otherDraft);
        const savedBackup = localStorage.getItem(`${storageKey}-before-inspiration`) || localStorage.getItem(`${sourceKey}-before-inspiration`);
        if (savedBackup) { const parsed = JSON.parse(savedBackup); if (parsed.content_type === initialType) setBackup(parsed); }
      } catch { setNotice("浏览器草稿无法读取，请手动填写并及时保存。"); }
      setReady(true);
    });
    return () => { disposed = true; };
  }, [storageKey, initialType, reference, mode, draftSourceId]);

  useEffect(() => {
    snapshotRef.current = draft;
    if (!ready) return;
    let failed = false;
    let disposed = false;
    try { localStorage.setItem(storageKey, jsonBody(draft)); }
    catch { failed = true; }
    void Promise.resolve().then(() => { if (!disposed) setCacheError(failed); });
    return () => { disposed = true; };
  }, [draft, ready, storageKey]);

  const update = (patch: Partial<CreationDraft>) => { history.record(draft); setDraft(current => ({ ...current, ...patch })); };

  function apply(analysis: WorkInput) {
    try {
      const next = applyInspiration(draft, analysis);
      setBackup(draft);
      try { localStorage.setItem(`${storageKey}-before-inspiration`, jsonBody(draft)); } catch { /* In-memory undo remains available. */ }
      history.record(draft); setDraft({ ...next, step: "premise" }); setInspiration(false); setError("");
      setNotice("方案已回填。请检查故事想法、题材、核心设定、世界观及生成参数，确认后再创建作品。");
    } catch (e) { setError(e instanceof Error ? e.message : "方案回填失败"); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !ready || created.current) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const generate = submitter instanceof HTMLButtonElement && submitter.value === "generate";
    lock.current = true; setError(""); setBusy(true);
    try {
      const payload = creationPayload(draft, mode, generate, reference, initialType);
      if (generate && step === "chapter" && number > payload.units) throw new Error("当前正文编号超出计划，请先调整计划集／章数或选择范围内的正文。");
      const intent = { generate, step, number };
      const { work, warning } = await createWorkForStep(payload, intent, saved => {
        created.current = saved;
        try { localStorage.removeItem(storageKey); if (restoredKey.current && restoredKey.current !== storageKey) localStorage.removeItem(restoredKey.current); } catch { /* A saved work must still open if browser storage is blocked. */ }
      });
      await onCreated(work, intent, warning);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建失败"); if (!draft.title.trim() || !draft.premise.trim() && generate) update({ step: "premise" }); }
    finally { lock.current = false; setBusy(false); }
  }

  const type = initialType;
  const step = editorSteps.includes(draft.step!) ? draft.step! : "premise";
  const labels = editorLabels(type);
  const nextStep = nextEditorStep(step);
  const safeUnits = Math.min(200, Math.max(1, Math.floor(Number(draft.units) || 1)));
  const number = draft.chapter_number && Number.isInteger(draft.chapter_number) && draft.chapter_number >= 1 && draft.chapter_number <= 200 ? draft.chapter_number : 1;
  const disabled = busy || !ready || !!created.current;
  function selectStep(next: typeof step) { update({ step: next }); revealWritingStage(); }

  function generateCurrent() { if (formRef.current && generateRef.current) formRef.current.requestSubmit(generateRef.current); }
  return <>
    <ProjectTitle type={type} title={draft.title} disabled={disabled} onChange={title => update({ title })} />
    <ProjectToolbar type={type} current={step} disabled={disabled} value={{ ...draft, units: safeUnits }} onSelect={next => setDraft(current => ({ ...current, step: next }))} actions={<>
      <div className={styles.history}><button type="button" title="撤销" aria-label="撤销" disabled={disabled || !history.canUndo} onClick={() => history.undo(draft,setDraft)}><RotateCcw size={20} /></button><button type="button" title="重做" aria-label="重做" disabled={disabled || !history.canRedo} onClick={() => history.redo(draft,setDraft)}><RotateCw size={20} /></button></div>
      {step === "premise" && <button type="button" className={`${styles.primary} ${styles.inspiration}`} disabled={disabled} onClick={() => setInspiration(true)}><Sparkles size={17} />灵感创作</button>}
      <>
        {step === "chapter" && <button type="button" className={styles.tool} onClick={() => exportWord(draft.title,draft.chapters)}><Download size={17} />导出为Word</button>}
        {step !== "settings" && <button ref={generateRef} form="plotloom-create-form" type="submit" name="intent" value="generate" className={styles.primary} disabled={disabled}><Sparkles size={17} />AI 生成{labels[step]}</button>}
      </>
    </>} />
    <div className={styles.workspace}><form ref={formRef} id="plotloom-create-form" className={styles.form} onSubmit={submit} onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement && !event.defaultPrevented && event.target.getAttribute("role") !== "combobox") event.preventDefault(); }} noValidate>
      {sampleInput && <p className={styles.inlineMessage}>已载入官方样例设定，可自由修改，写出你自己的版本。确认下方设定后再开始创作。</p>}
      {cacheError && <p className={styles.inlineMessage} role="status">当前浏览器无法保存新建草稿，请及时点击“保存全部内容，创建作品”，将输入保存到作品中。</p>}
      {notice && <p className={styles.inlineMessage} role="status">{notice}</p>}
      {backup && <button type="button" className="text-button" disabled={busy} onClick={() => { history.record(draft); setDraft(backup); setNotice("已恢复回填前的表单，灵感方案仍保留。"); }}>恢复回填前的表单</button>}
      {otherTypeDraft && <button type="button" className="outline-button" onClick={() => downloadText("旧类型创作草稿.json", otherTypeDraft, "application/json")}>导出旧类型草稿备份</button>}
      <div id="writing-stage-panel" role="tabpanel" aria-labelledby={`writing-tab-${step}`} className={styles.stage}>
        {step === "premise" && <ProjectSettings type={type} value={projectSettingsFromDraft(draft)} disabled={disabled} onChange={patch => update(applyProjectSettings(draft,patch))}>
          <div className={styles.worldArea}>
            {draft.source_text && ["小说改编", "剧本改写"].includes(mode) && <details><summary>回填前的原始素材（创建作品时一并保留）</summary><pre className="plotloom-pre">{draft.source_text}</pre></details>}
            <label>导入 TXT 素材（最多2 MB / 50,000字符）<input type="file" accept=".txt,text/plain" disabled={disabled} onChange={async e => {
              const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
              const previous = snapshotRef.current.premise; setError("");
              try { if (file.size > 2 * 1024 * 1024) throw new Error("文件超过2 MB。"); const text = await file.text(); if (text.length > 50000) throw new Error("文件超过50,000字符。"); if (snapshotRef.current.premise !== previous) throw new Error("读取文件期间故事想法已修改，请重新选择文件。"); update({ premise: text }); }
              catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
            }} /></label>
          </div>
        </ProjectSettings>}
        {step === "settings" && <ProjectParameters type={type} value={projectSettingsFromDraft(draft)} worlds={worlds} sections={sections} worldId={draft.world_id} disabled={disabled} onChange={patch => update(applyProjectSettings(draft, patch))} onWorldChange={(world, sourceId) => update({ world_snapshot: world, world_id: sourceId || "" })} />}
        {step === "characters" && <CharacterEditor value={draft.characters} disabled={disabled} onChange={characters => update({ characters })} onGenerate={generateCurrent} />}
        {step === "outline" && <OutlineEditor value={draft.outline} type={type} units={safeUnits} disabled={disabled} onChange={outline => update({ outline })} />}
        {step === "chapter" && <ManuscriptEditor type={type} chapters={draft.chapters} units={safeUnits} number={number} disabled={disabled} onNumber={number => update({ chapter_number: number })} onChange={chapters => update({ chapters })} onGenerate={generateCurrent} />}
      </div>
      {error && <p className="studio-error" role="alert">{error}</p>}
      {created.current && <a className="text-button" href={`/studio/works/${created.current.id}`}>草稿已创建，打开作品 →</a>}
      <div className={styles.bottom}><div>{nextStep && <button type="button" className={styles.tool} disabled={disabled} onClick={() => selectStep(nextStep)}>继续：{labels[nextStep]} →</button>}<button type="submit" name="intent" value="draft" className={styles.primary} disabled={disabled}>{busy ? "正在保存…" : "保存全部内容，创建作品"}</button><button type="button" className="text-button" disabled={busy} onClick={onClose}>返回作品库</button></div></div>
    </form></div>
    {inspiration && <Inspiration key={type} type={type} initialPrompt={draft.premise} onApply={apply} onClose={() => setInspiration(false)} />}
  </>;
}
