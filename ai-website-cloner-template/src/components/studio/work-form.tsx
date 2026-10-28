"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { jsonBody, downloadText, type Chapter, type ContentType, type Reference, type Section, type Work, type World, type WorkInput } from "@/lib/studio/api";
import { createWorkForStep } from "@/lib/studio/creation";
import { applyInspiration, creationPayload, initialCreationDraft, type CreationDraft } from "@/lib/studio/inspiration";
import { Inspiration } from "./inspiration";
import { WritingOptions } from "./writing-options";
import { novelGenres, dramaGenres, creationDraftKeys } from "@/lib/studio/writing";
import { writingLabels, writingSteps, type CreationIntent } from "@/lib/studio/workflow";
import { WorkflowNav, revealWritingStage } from "./workflow-nav";
import { CharacterEditor } from "./character-editor";
import styles from "./workflow.module.css";

export function WorkForm({ mode, kind, worlds, reference, sections = [], sampleId, sampleInput, onCreated, onClose }: {
  mode: string; kind?: ContentType; worlds: World[]; reference?: Reference; sections?: Section[];
  sampleId?: string; sampleInput?: WorkInput;
  onCreated: (work: Work, intent: CreationIntent, warning: string) => void | Promise<void>; onClose: () => void;
}) {
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

  const update = (patch: Partial<CreationDraft>) => setDraft(current => ({ ...current, ...patch }));

  function apply(analysis: WorkInput) {
    try {
      const next = applyInspiration(draft, analysis);
      setBackup(draft);
      try { localStorage.setItem(`${storageKey}-before-inspiration`, jsonBody(draft)); } catch { /* In-memory undo remains available. */ }
      setDraft({ ...next, step: "premise" }); setInspiration(false); setError("");
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

  const world = draft.world_snapshot;
  const type = initialType;
  const step = writingSteps.includes(draft.step!) ? draft.step! : "premise";
  const labels = writingLabels(type);
  const unit = type === "novel" ? "章" : "集";
  const safeUnits = Math.min(200, Math.max(1, Math.floor(Number(draft.units) || 1)));
  const number = draft.chapter_number && Number.isInteger(draft.chapter_number) && draft.chapter_number >= 1 && draft.chapter_number <= 200 ? draft.chapter_number : 1;
  const chapter = draft.chapters.find(c => c.number === number);
  const disabled = busy || !ready || !!created.current;
  function selectStep(next: typeof step) { update({ step: next }); revealWritingStage(); }
  function changeChapter(patch: Partial<Chapter>) {
    const next = { number, title: `第${number}${unit}`, content: "", ...chapter, ...patch };
    update({ chapters: [...draft.chapters.filter(c => c.number !== number), next].sort((a, b) => a.number - b.number) });
  }
  function changeWorld(patch: Partial<NonNullable<CreationDraft["world_snapshot"]>>) {
    update({ world_id: "", world_snapshot: { name: world?.name || "作品专属世界", description: world?.description || "", sections: world?.sections || {}, ...patch } });
  }

  return <>
    <WorkflowNav type={type} current={step} disabled={disabled} value={{ ...draft, units: safeUnits }} onSelect={next => update({ step: next })} action={step === "premise" && <button type="button" className="inspiration-primary" disabled={disabled} onClick={() => setInspiration(true)}><Sparkles size={17} /> 灵感创作</button>} />
    <form className={`create-form studio-form ${styles.newForm}`} onSubmit={submit} onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }} noValidate>
      {sampleInput && <p className="studio-inline-notice">已载入官方样例设定，可自由修改，写出你自己的版本。确认下方设定后再开始创作。</p>}
      {cacheError && <p className="studio-inline-notice" role="status">当前浏览器无法保存新建草稿，请及时点击“保存全部内容，创建作品”，将输入保存到作品中。</p>}
      {notice && <p className="studio-inline-notice" role="status">{notice}{backup && <button type="button" className="text-button" disabled={busy} onClick={() => { setDraft(backup); setNotice("已恢复回填前的表单，灵感方案仍保留。"); }}>恢复回填前的表单</button>}</p>}
      {!notice && backup && <button type="button" className="text-button" disabled={busy} onClick={() => { setDraft(backup); setNotice("已恢复回填前的表单，灵感方案仍保留。"); }}>恢复回填前的表单</button>}
      {otherTypeDraft && <button type="button" className="outline-button" onClick={() => downloadText("旧类型创作草稿.json", otherTypeDraft, "application/json")}>导出旧类型草稿备份</button>}
      <div id="writing-stage-panel" role="tabpanel" aria-labelledby={`writing-tab-${step}`} className={`${styles.stage} ${styles.newPanel}`}>
      <div className={styles.stageHeading}><div><h2>{labels[step]}</h2><p>{step === "premise" ? "确定故事方向与创作参数。" : step === "characters" ? "选择右侧角色，完善人物经历与关系。" : step === "outline" ? `安排每${unit}发生的事件、冲突与转折。` : `选择要写的${unit}，开始编写正文。`}</p></div>{step !== "premise" && <button type="submit" name="intent" value="generate" className="inspiration-primary" disabled={disabled}><Sparkles size={16} /> AI 生成{labels[step]}</button>}</div>
      {step === "premise" && <fieldset disabled={disabled} className="creation-fields">
        <label>{type === "novel" ? "书名" : "剧名"}<input name="title" required maxLength={80} value={draft.title} onChange={e => update({ title: e.target.value })} placeholder={type === "novel" ? "给小说起个名字" : "给剧本起个名字"} /></label>
        <WritingOptions kind={type} novel={draft.novel_settings} drama={draft.drama_settings} onChange={patch => update(patch)} />
        <div className="form-row"><label>计划{type === "novel" ? "章节" : "集数"}<input name="units" type="number" min={1} max={200} required value={draft.units} onChange={e => update({ units: e.target.value })} /></label>
          <label>{type === "novel" ? "小说主分类" : "短剧题材"}<select name="genre" value={draft.genre} onChange={e => update({ genre: e.target.value })}>{[...new Set([draft.genre, ...(type === "novel" ? novelGenres : dramaGenres)])].map(genre => <option key={genre}>{genre}</option>)}</select></label>
          <label>{type === "novel" ? "每章目标字数" : "每集剧本字数"}<input name="words" type="number" min={300} max={type === "novel" ? 6000 : 3000} required value={draft.words} onChange={e => update({ words: e.target.value })} /></label></div>
        <div className="form-row"><label>目标受众<select name="audience" value={draft.audience} onChange={e => update({ audience: e.target.value as CreationDraft["audience"] })}><option value="general">不限</option><option value="male">男性向</option><option value="female">女性向</option></select></label>
          <label>从世界库复制<select name="world_id" value={draft.world_id} onChange={e => { const item = worlds.find(w => w.id === e.target.value); update({ world_id: item?.id || "", world_snapshot: item ? { name: item.name, description: item.description, sections: { ...item.sections } } : null }); }}><option value="">{world ? "使用下方作品专属世界" : "暂不绑定"}</option>{worlds.map(w => <option value={w.id} key={w.id}>{w.name} · v{w.revision}</option>)}</select></label></div>
        <div className="form-row">{([ ["genres", "自定义题材", 3, "留空使用上方题材"], ["core", "核心设定", 3, "如：时间循环"], ["styles", "风格", 5, "如：温暖"] ] as const).map(([field, label, max, placeholder]) => {
          const source = draft.tag_source?.[field];
          const needsConfirmation = draft.tag_format === "lines" && Array.isArray(source) && source.some(s => typeof s === "string" && /[\r\n]/.test(s)) && source.join("\n") !== draft[field];
          return <label key={field}>{label}（最多{max}项）
            {draft.tag_format === "lines"
              ? <textarea name={field} rows={3} value={draft[field]} onChange={e => update({ [field]: e.target.value })} placeholder={`${placeholder}，每行一项`} />
              : <input name={field} value={draft[field]} onChange={e => update({ [field]: e.target.value })} placeholder={`${placeholder}，逗号分隔`} />}
            {draft.tag_format === "lines" && <small className="studio-hint">每行一项，可在内容中使用逗号</small>}
            {needsConfirmation && draft.tag_source && <><small className="studio-hint">原始项目内含换行，请检查并将每项整理为一行。</small><button type="button" className="text-button" onClick={() => update({ tag_source: { ...draft.tag_source!, [field]: [] } })}>已整理，确认标签分隔</button></>}
          </label>;
        })}</div>
        <label>{type === "novel" ? "阅读看点与人物成长" : "视觉钩子与反转亮点"}<textarea name="highlights" rows={3} maxLength={5000} value={draft.highlights} onChange={e => update({ highlights: e.target.value })} placeholder={type === "novel" ? "读者为什么会关心主角？主角将经历怎样的变化？" : "开场怎样抓住观众？每集靠什么冲突和反转推动？"} /></label>
        <label>{mode === "小说改编" ? "小说素材与改编方向" : mode === "剧本改写" ? "已有原稿与改写方向" : "故事想法"}<textarea rows={7} maxLength={50000} value={draft.premise} onChange={e => update({ premise: e.target.value })} placeholder="人物是谁？想要什么？会遇到怎样的冲突？" /></label>
        {draft.source_text && ["小说改编", "剧本改写"].includes(mode) && <details><summary>回填前的原始素材（创建作品时一并保留）</summary><pre className="plotloom-pre">{draft.source_text}</pre></details>}
        <section className="creation-world"><div className="studio-section-bar"><h3>作品世界观</h3>{!world && <button type="button" className="outline-button" onClick={() => changeWorld({})}>添加世界观</button>}</div>{world && <><p className="studio-hint">此处设定随作品独立保存，可继续编辑，不会修改世界库原件。</p><label>世界名称<input maxLength={80} value={world.name} onChange={e => changeWorld({ name: e.target.value })} required /></label><label>世界概述<textarea rows={3} maxLength={5000} value={world.description} onChange={e => changeWorld({ description: e.target.value })} /></label>{sections.map(s => <details key={s.id} open={s.id === "basics"}><summary>{s.label}</summary>{s.fields.map(f => <label key={f.key}>{f.label}<textarea rows={3} maxLength={20000} value={world.sections[f.key] || ""} onChange={e => changeWorld({ sections: { ...world.sections, [f.key]: e.target.value } })} /></label>)}</details>)}</>}</section>
        <label className="studio-file-input">导入 TXT 素材（最多2 MB / 50,000字符）<input type="file" accept=".txt,text/plain" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
          const previous = snapshotRef.current.premise;
          setError("");
          try {
            if (file.size > 2 * 1024 * 1024) throw new Error("文件超过2 MB。");
            const text = await file.text();
            if (text.length > 50000) throw new Error("文件超过50,000字符。");
            if (snapshotRef.current.premise !== previous) throw new Error("读取文件期间故事想法已修改，请重新选择文件。");
            update({ premise: text });
          } catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
        }} /></label>
      </fieldset>}
      {step === "characters" && <CharacterEditor value={draft.characters} disabled={disabled} onChange={characters => update({ characters })} />}
      {step === "outline" && <label>{labels.outline}<textarea rows={18} maxLength={50000} disabled={disabled} value={draft.outline} onChange={e => update({ outline: e.target.value })} placeholder={`第1${unit}：开端与核心冲突……\n第2${unit}：矛盾升级与新变化……`} /></label>}
      {step === "chapter" && <><div className="form-row"><label>正文目录<select disabled={disabled} value={number} onChange={e => update({ chapter_number: Number(e.target.value) })}>{[...new Set([...Array.from({ length: safeUnits }, (_, i) => i + 1), number, ...draft.chapters.map(c => c.number)])].sort((a, b) => a - b).map(n => <option key={n} value={n}>第{n}{unit}{draft.chapters.some(c => c.number === n && c.content.trim()) ? " · 已填写" : ""}</option>)}</select></label><label>本{unit}标题<input disabled={disabled} maxLength={80} value={chapter?.title || ""} onChange={e => changeChapter({ title: e.target.value })} placeholder={`第${number}${unit}`} /></label></div><label>{labels.chapter}<textarea rows={20} maxLength={150000} disabled={disabled} value={chapter?.content || ""} onChange={e => changeChapter({ content: e.target.value })} placeholder={type === "novel" ? "从一个具体场景开始，写下人物的行动、心理与对话……" : "场1 地点 日 内\n出场人物：……\n动作与对白……"} /></label></>}
      <div className={styles.stageNext}><p>{step === "chapter" ? `已填写 ${draft.chapters.filter(c => c.content.trim()).length}/${safeUnits}${unit}正文` : "切换步骤会保留当前输入，无需按顺序填写。"}</p><div className={styles.stageActions}>{step !== "premise" && <button type="button" className="outline-button" disabled={disabled} onClick={() => selectStep(writingSteps[writingSteps.indexOf(step) - 1])}>上一步</button>}{step !== "chapter" && <button type="button" className="outline-button" disabled={disabled} onClick={() => selectStep(writingSteps[writingSteps.indexOf(step) + 1])}>继续：{labels[writingSteps[writingSteps.indexOf(step) + 1]]} →</button>}</div></div>
      </div>
      <p className="form-note">中国市场 · 中文输出 · 新建草稿会在此浏览器保留。AI 生成结果需审阅采纳。</p>
      {error && <p className="studio-error" role="alert">{error}</p>}
      {created.current && <a className="text-button" href={`/studio/works/${created.current.id}`}>草稿已创建，打开作品 →</a>}
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onClose}>返回作品库</button><button type="submit" name="intent" value="draft" className="pill light" disabled={disabled}>{busy ? "正在保存…" : "保存全部内容，创建作品"}</button></div>
    </form>
    {inspiration && <Inspiration key={type} type={type} initialPrompt={draft.premise} onApply={apply} onClose={() => setInspiration(false)} />}
  </>;
}
