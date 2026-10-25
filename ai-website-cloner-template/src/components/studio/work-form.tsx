"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { backendRequest, jsonBody, type ContentType, type Reference, type Section, type Work, type World, type WorkInput } from "@/lib/studio/api";
import { applyInspiration, creationPayload, initialCreationDraft, type CreationDraft } from "@/lib/studio/inspiration";
import { Inspiration } from "./inspiration";

export function WorkForm({ mode, kind, worlds, reference, sections = [], onCreated, onClose }: {
  mode: string; kind?: ContentType; worlds: World[]; reference?: Reference; sections?: Section[];
  onCreated: (work: Work, generate: boolean) => void | Promise<void>; onClose: () => void;
}) {
  const initialType: ContentType = reference?.content_type || kind || (mode === "小说创作" ? "novel" : "short_drama");
  const [draft, setDraft] = useState(() => initialCreationDraft(initialType, reference));
  const [inspiration, setInspiration] = useState(mode === "灵感策划" || mode === "灵感创作");
  const [backup, setBackup] = useState<CreationDraft>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const lock = useRef(false);
  const snapshotRef = useRef(draft);
  const storageKey = `plotloom-new-${initialType}-${mode}-${reference?.id || "original"}`;

  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(() => {
      if (disposed) return;
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const cached = JSON.parse(raw) as CreationDraft;
          if (["novel", "short_drama"].includes(cached.content_type) && typeof cached.premise === "string" && typeof cached.title === "string") {
            setDraft(cached); setNotice("已恢复此浏览器的新建草稿，请继续编辑。");
          }
        }
        const savedBackup = localStorage.getItem(`${storageKey}-before-inspiration`);
        if (savedBackup) setBackup(JSON.parse(savedBackup));
      } catch { setNotice("浏览器草稿无法读取，请手动填写并及时保存。"); }
      setReady(true);
    });
    return () => { disposed = true; };
  }, [storageKey]);

  useEffect(() => {
    snapshotRef.current = draft;
    if (!ready) return;
    try { localStorage.setItem(storageKey, jsonBody(draft)); }
    catch { /* Form values remain available for manual saving. */ }
  }, [draft, ready, storageKey]);

  const update = (patch: Partial<CreationDraft>) => setDraft(current => ({ ...current, ...patch }));

  function apply(analysis: WorkInput) {
    try {
      const next = applyInspiration(draft, analysis);
      setBackup(draft);
      try { localStorage.setItem(`${storageKey}-before-inspiration`, jsonBody(draft)); } catch { /* In-memory undo remains available. */ }
      setDraft(next); setInspiration(false); setError("");
      setNotice("方案已回填。请检查故事想法、题材、核心设定、世界观及生成参数，确认后再创建作品。");
    } catch (e) { setError(e instanceof Error ? e.message : "方案回填失败"); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !ready) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const generate = !(submitter instanceof HTMLButtonElement && submitter.value === "draft");
    lock.current = true; setError(""); setBusy(true);
    try {
      const payload = creationPayload(draft, mode, generate, reference);
      const work = await backendRequest<Work>("/studio/works", { method: "POST", body: jsonBody(payload) });
      try { localStorage.removeItem(storageKey); } catch { /* A saved work must still open if browser storage is blocked. */ }
      await onCreated(work, generate);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建失败"); }
    finally { lock.current = false; setBusy(false); }
  }

  const world = draft.world_snapshot;
  const type = draft.content_type;
  function changeWorld(patch: Partial<NonNullable<CreationDraft["world_snapshot"]>>) {
    update({ world_id: "", world_snapshot: { name: world?.name || "作品专属世界", description: world?.description || "", sections: world?.sections || {}, ...patch } });
  }

  return <>
    <div className="inspiration-entry"><div><span className="inspiration-eyebrow"><Sparkles size={16} /> 灵感创作</span><h2>有一个念头，还没想好怎么写？</h2><p>用自然语言描述想法，获得三个可修改的方案，再自动填写创作设定。</p></div><button type="button" className="inspiration-primary" disabled={busy || !ready} onClick={() => setInspiration(true)}><Sparkles size={17} /> 开始灵感创作</button></div>
    <form className="create-form studio-form" onSubmit={submit}>
      <p className="modal-description">确认下面的设定后，点击“创建并 AI 生成”完善故事设定，再依次生成人物、大纲和正文。也可先创建草稿。</p>
      {notice && <p className="studio-inline-notice" role="status">{notice}{backup && <button type="button" className="text-button" disabled={busy} onClick={() => { setDraft(backup); setNotice("已恢复回填前的表单，灵感方案仍保留。"); }}>恢复回填前的表单</button>}</p>}
      <fieldset disabled={busy || !ready} className="creation-fields">
        <label>作品名称<input name="title" required maxLength={80} value={draft.title} onChange={e => update({ title: e.target.value })} placeholder="给故事起个名字" /></label>
        <div className="form-row"><label>创作类型<select name="content_type" value={type} onChange={e => update({ content_type: e.target.value as ContentType })} disabled={!!reference}><option value="short_drama">剧本创作</option><option value="novel">小说创作</option></select></label>
          <label>计划{type === "novel" ? "章节" : "集数"}<input name="units" type="number" min={1} max={200} required value={draft.units} onChange={e => update({ units: e.target.value })} /></label>
          <label>题材<select name="genre" value={draft.genre} onChange={e => update({ genre: e.target.value })}>{[...new Set([draft.genre, "都市", "悬疑", "玄幻", "古装", "甜宠", "家庭", "科幻", "其他"])].map(genre => <option key={genre}>{genre}</option>)}</select></label></div>
        <div className="form-row"><label>目标受众<select name="audience" value={draft.audience} onChange={e => update({ audience: e.target.value as CreationDraft["audience"] })}><option value="general">不限</option><option value="male">男性向</option><option value="female">女性向</option></select></label>
          <label>每{type === "novel" ? "章" : "集"}目标字数<input name="words" type="number" min={300} max={3000} required value={draft.words} onChange={e => update({ words: e.target.value })} /></label>
          <label>从世界库复制<select name="world_id" value={draft.world_id} onChange={e => { const item = worlds.find(w => w.id === e.target.value); update({ world_id: item?.id || "", world_snapshot: item ? { name: item.name, description: item.description, sections: { ...item.sections } } : null }); }}><option value="">{world ? "使用下方作品专属世界" : "暂不绑定"}</option>{worlds.map(w => <option value={w.id} key={w.id}>{w.name} · v{w.revision}</option>)}</select></label></div>
        <div className="form-row"><label>自定义题材（最多3项）<input name="genres" maxLength={240} value={draft.genres} onChange={e => update({ genres: e.target.value })} placeholder="留空使用上方题材，逗号分隔" /></label><label>核心设定（最多3项）<input name="core" maxLength={240} value={draft.core} onChange={e => update({ core: e.target.value })} placeholder="时间循环，身份错位" /></label><label>风格（最多5项）<input name="styles" maxLength={400} value={draft.styles} onChange={e => update({ styles: e.target.value })} placeholder="温暖，悬疑" /></label></div>
        <label>核心亮点<textarea name="highlights" rows={3} maxLength={5000} value={draft.highlights} onChange={e => update({ highlights: e.target.value })} placeholder="这个故事最吸引人的地方是什么？" /></label>
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
      </fieldset>
      <p className="form-note">中国市场 · 中文输出 · 新建草稿会在此浏览器保留。AI 生成结果需审阅采纳。</p>
      {error && <p className="studio-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onClose}>返回作品库</button><button type="submit" name="intent" value="generate" className="pill light" disabled={busy || !ready}>{busy ? "正在创建…" : "确认设定，创建并 AI 生成"}</button><button type="submit" name="intent" value="draft" className="outline-button" disabled={busy || !ready}>仅创建草稿</button></div>
    </form>
    {inspiration && <Inspiration key={type} type={type} initialPrompt={draft.premise} onApply={apply} onClose={() => setInspiration(false)} />}
  </>;
}
