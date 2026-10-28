"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ContactRound, Check, ChevronDown, ChevronUp, Download, FileText, Lightbulb, Mars, Minus, Plus, RotateCcw, RotateCw, Settings, Sparkles, Trash2, UserPlus, Venus, X } from "lucide-react";
import { emptyDraft, escapeDocument, newPerson, readDraft, type Person, type PreviewDraft } from "./model";
import styles from "./preview.module.css";

const tabs = ["故事梗概", "人物小传", "分集大纲", "剧本正文"];
const phases = ["起", "承", "转", "合"];
const anchors = ["目标受众", "题材类型", "核心设定", "风格元素", "世界观", "核心亮点", "核心梗概"];
const genreOptions = ["都市", "悬疑", "爱情", "古装", "奇幻", "科幻", "家庭", "职场", "喜剧", "年代"];
const coreOptions = ["身份反差", "双向救赎", "逆境成长", "时间循环", "秘密交易", "重逢", "追寻真相", "家庭羁绊"];
const styleOptions = ["轻松幽默", "悬念迭起", "温暖治愈", "快节奏", "情感细腻", "现实主义", "热血", "浪漫"];

export function CreationPreview({ id, children }: { id: string; children: ReactNode }) {
  const pathname = usePathname();
  const step = Number(pathname.split("/").at(-1)) || 1;
  const [draft, setDraft] = useState<PreviewDraft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const [past, setPast] = useState<PreviewDraft[]>([]);
  const [future, setFuture] = useState<PreviewDraft[]>([]);
  const [personId, setPersonId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [phase, setPhase] = useState(0);
  const [roughOpen, setRoughOpen] = useState(true);
  const [modal, setModal] = useState<"ai" | "words" | "translate" | "inspiration" | "delete" | null>(null);
  const [notice, setNotice] = useState("");
  const [wordInput, setWordInput] = useState("800");
  const [activeAnchor, setActiveAnchor] = useState(0);
  const storageKey = `plotloom-reference-preview-v1:${id}`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const mountedDraft = useRef(false);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try { const raw = localStorage.getItem(storageKey); if (raw) setDraft(readDraft(raw)); }
      catch { setNotice("本地草稿无法读取，原记录已保留。本次可继续体验，输入不会提交到服务器。"); }
      setReady(true);
    });
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    // Do not replace a corrupt or incompatible old draft just by opening the preview.
    if (!mountedDraft.current) { mountedDraft.current = true; return; }
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, draft })); }
    catch { Promise.resolve().then(() => setNotice("浏览器无法保存草稿，请导出正文留存。")); }
  }, [draft, ready, storageKey]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (modal && dialog && !dialog.open) { dialogTrigger.current = document.activeElement as HTMLElement; dialog.showModal(); }
    if (!modal && dialog?.open) { dialog.close(); dialogTrigger.current?.focus(); }
  }, [modal]);

  function edit(patch: Partial<PreviewDraft>) {
    setPast(previous => [...previous.slice(-59), draft]); setFuture([]);
    setDraft({ ...draft, ...patch });
  }
  function undo() {
    const previous = past.at(-1); if (!previous) return;
    setFuture(next => [draft, ...next]); setDraft(previous); setPast(past.slice(0, -1));
  }
  function redo() {
    const next = future[0]; if (!next) return;
    setPast(previous => [...previous, draft]); setDraft(next); setFuture(future.slice(1));
  }
  function addPerson() {
    const person = newPerson(); edit({ characters: [...draft.characters, person] }); setPersonId(person.id);
  }
  const person = draft.characters.find(p => p.id === personId) || draft.characters[0];
  const episode = draft.episodes.find(e => e.id === episodeId) || draft.episodes[0];
  function editPerson(patch: Partial<Person>) {
    if (person) edit({ characters: draft.characters.map(p => p.id === person.id ? { ...p, ...patch } : p) });
  }
  function addEpisode() {
    const next = { id: crypto.randomUUID(), title: `第${draft.episodes.length + 1}集`, text: "" };
    edit({ episodes: [...draft.episodes, next] }); setEpisodeId(next.id);
  }
  function exportWord() {
    if (!draft.episodes.some(e => e.text.trim())) { setNotice("请先创建新集并填写正文，再导出 Word 文档。"); return; }
    const document = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeDocument(draft.title)}</title></head><body><h1>${escapeDocument(draft.title)}</h1>${draft.episodes.map(e => `<h2>${escapeDocument(e.title)}</h2><p>${escapeDocument(e.text).replaceAll("\n", "<br>")}</p>`).join("")}</body></html>`;
    const url = URL.createObjectURL(new Blob(["\ufeff", document], { type: "application/msword;charset=utf-8" }));
    const link = window.document.createElement("a"); link.href = url; link.download = `${draft.title.replace(/[\\/:*?"<>|]/g, "-") || "剧本"}.doc`;
    window.document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function scrollToAnchor(index: number) {
    setActiveAnchor(index); document.getElementById(`setting-${index}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const aiButton = (text: string) => <button type="button" className={styles.primary} disabled={!ready || !draft.premise.trim()} onClick={() => setModal("ai")}><Sparkles size={20} />{text}</button>;

  return <div className={styles.preview}>
    <header className={styles.header}><div className={styles.titleMark}><Sparkles size={20} /></div><input aria-label="剧本名称" value={draft.title} maxLength={80} onChange={e => edit({ title: e.target.value })} /><span className={styles.previewLabel}>本地预览</span></header>
    <main className={styles.workspace}>
      <div className={styles.toolbar}>
        <nav className={styles.tabs} aria-label="创作步骤">{tabs.map((name, index) => <Link key={name} href={`/creation/${encodeURIComponent(id)}/${index + 1}`} aria-current={step === index + 1 ? "step" : undefined} className={step === index + 1 ? styles.activeTab : ""}>{name}</Link>)}</nav>
        <div className={styles.actions}>
          {step < 4 && <div className={styles.history}><button type="button" aria-label="撤销" title="撤销" disabled={!past.length} onClick={undo}><RotateCcw size={23} /></button>{step !== 2 && <button type="button" aria-label="重做" title="重做" disabled={!future.length} onClick={redo}><RotateCw size={23} /></button>}</div>}
          {step === 1 && <button type="button" className={`${styles.primary} ${styles.inspiration}`} onClick={() => setModal("inspiration")}><Lightbulb size={21} />灵感策划</button>}
          {step === 2 && aiButton("AI生成")}
          {step === 3 && aiButton("AI生成全部粗纲")}
          {step === 4 && <><button type="button" className={styles.toolButton} onClick={exportWord}><Download size={21} />导出为Word</button><button type="button" className={styles.toolButton} onClick={() => { setWordInput(String(draft.words)); setModal("words"); }}><Settings size={21} />正文字数</button><button type="button" className={styles.primary} onClick={() => setModal("translate")}><Sparkles size={20} />对白翻译</button></>}
        </div>
      </div>
      {notice && <div className={styles.notice} role="status">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice("")}><X size={16} /></button></div>}
      {step === 1 && <div className={styles.settingsLayout}>
        <section className={styles.settings} aria-label="故事设定"><h1>故事设定</h1><div className={styles.settingGrid}>
          <div id="setting-0" className={styles.field}><span>目标受众 <b>*</b></span><div className={styles.audience}><button type="button" aria-pressed={draft.audience === "male"} className={`${styles.male} ${draft.audience === "male" ? styles.chosen : ""}`} onClick={() => edit({ audience: draft.audience === "male" ? "" : "male" })}><Mars size={22} />男频</button><button type="button" aria-pressed={draft.audience === "female"} className={`${styles.female} ${draft.audience === "female" ? styles.chosen : ""}`} onClick={() => edit({ audience: draft.audience === "female" ? "" : "female" })}><Venus size={22} />女频</button></div></div>
          <div id="setting-1"><TagPicker label="题材类型" max={3} placeholder="选择或自定义输入背景" options={genreOptions} value={draft.genres} onChange={genres => edit({ genres })} /></div>
          <div id="setting-2"><TagPicker label="核心设定" max={3} placeholder="选择或自定义输入类型" options={coreOptions} value={draft.core} onChange={core => edit({ core })} /></div>
          <div id="setting-3"><TagPicker label="风格元素" max={5} placeholder="选择或自定义输入设定" options={styleOptions} value={draft.styles} onChange={value => edit({ styles: value })} /></div>
          <label id="setting-4" className={`${styles.field} ${styles.fullWidth}`}>世界观（选填）<textarea rows={2} maxLength={5000} value={draft.world} onChange={e => edit({ world: e.target.value })} placeholder="例：世界存在一种失传的“织墨术”，顶尖修复师能以特制丝线“绣”补古画，不仅可恢复品相，技艺至高者甚至能通过画中“墨绣”窥见历史隐秘。此技艺引来了正统修复派、投机商和境外势力的争抢。" /></label>
          <label id="setting-5" className={`${styles.field} ${styles.fullWidth}`}>核心亮点（选填）<input maxLength={5000} value={draft.highlights} onChange={e => edit({ highlights: e.target.value })} placeholder="例：穿书成作死女配，她反向操作，用沙雕和直球硬核攻略哑巴老公，结果把冰山霸总撩到开口说话！" /></label>
          <label id="setting-6" className={`${styles.field} ${styles.fullWidth}`}><span>核心梗概 <b>*</b></span><textarea rows={3} maxLength={50000} value={draft.premise} onChange={e => edit({ premise: e.target.value })} /></label>
        </div></section>
        <nav className={styles.settingRail} aria-label="故事设定目录">{anchors.map((name, index) => <button type="button" key={name} className={index === activeAnchor ? styles.currentAnchor : ""} onClick={() => scrollToAnchor(index)}>{name}<i /></button>)}</nav>
      </div>}
      {step === 2 && <div className={styles.characterLayout}>
        {!person ? <section className={styles.emptyCharacter}><ContactRound size={66} strokeWidth={1.25} /><p>点击右侧按钮创建新角色，自定义角色信息<br />或由AI一键生成所有角色</p><button type="button" className={styles.whiteButton} onClick={() => setModal("ai")}>一键生成</button></section> : <section className={styles.personDetails} aria-label="人物详情"><div className={styles.personIdentity}><label className={styles.field}>姓名<input aria-label="人物姓名" value={person.name} maxLength={80} placeholder="角色姓名" onChange={e => editPerson({ name: e.target.value })} /></label><label className={styles.field}>定位<input value={person.role} maxLength={80} placeholder="主角 / 配角" onChange={e => editPerson({ role: e.target.value })} /></label><label className={styles.field}>年龄<div className={styles.age}><button type="button" aria-label="年龄减一" disabled={!/^\d+$/.test(person.age) || Number(person.age) <= 0} onClick={() => editPerson({ age: String(Number(person.age) - 1) })}><Minus size={16} /></button><input aria-label="人物年龄" value={person.age} maxLength={20} placeholder="未设定" onChange={e => editPerson({ age: e.target.value })} /><button type="button" aria-label="年龄加一" disabled={!/^\d+$/.test(person.age) || Number(person.age) >= 999} onClick={() => editPerson({ age: String(Number(person.age) + 1) })}><Plus size={16} /></button></div></label></div><label className={styles.field}>性格<input value={person.traits} placeholder="例如：冷静、果断、心软" maxLength={500} onChange={e => editPerson({ traits: e.target.value })} /></label><label className={styles.field}>背景<textarea rows={8} value={person.background} maxLength={10000} placeholder="写下角色的身份、经历与愿望" onChange={e => editPerson({ background: e.target.value })} /></label><label className={styles.field}>人物关系<textarea rows={3} value={person.relationships} maxLength={5000} placeholder="角色之间的羁绊与冲突" onChange={e => editPerson({ relationships: e.target.value })} /></label><button type="button" className={styles.deleteButton} onClick={() => setModal("delete")}><Trash2 size={15} />删除角色</button></section>}
        <div className={styles.characterCards} aria-label="角色列表">{draft.characters.map(item => <button type="button" key={item.id} className={`${styles.characterCard} ${item.id === person?.id ? styles.selectedCard : ""}`} aria-pressed={item.id === person?.id} onClick={() => setPersonId(item.id)}><strong>{item.name || "未命名角色"}</strong><small>{item.role}</small></button>)}<button type="button" className={styles.characterCard} aria-label="添加角色" onClick={addPerson}><UserPlus size={40} strokeWidth={1.5} /></button></div>
      </div>}
      {step === 3 && <div className={styles.outlineLayout}><section className={styles.outlineContent}>
        <div className={styles.rough}><button type="button" className={styles.sectionTitle} aria-expanded={roughOpen} onClick={() => setRoughOpen(!roughOpen)}><span>粗纲 <b>*</b></span>{roughOpen ? <ChevronUp size={19} /> : <ChevronDown size={19} />}</button>{roughOpen && <textarea aria-label="粗纲" placeholder="请输入内容，3000字以内" maxLength={3000} value={draft.rough} onChange={e => edit({ rough: e.target.value })} />}</div>
        <div className={styles.episodeHeading}><h1>集纲 <b>*</b></h1><button type="button" title="AI生成集纲" aria-label="AI生成集纲" onClick={() => setModal("ai")}><Sparkles size={21} /></button></div>
        {draft.outlines.map((outline, index) => outline.phase === phase && <label key={outline.id} className={styles.episodeOutline}><span>第{index + 1}集</span><textarea aria-label={`第${index + 1}集集纲`} value={outline.text} maxLength={5000} onChange={e => edit({ outlines: draft.outlines.map(item => item.id === outline.id ? { ...item, text: e.target.value } : item) })} /></label>)}
        <button type="button" className={styles.addOutline} onClick={() => edit({ outlines: [...draft.outlines, { id: crypto.randomUUID(), phase, text: "" }].sort((a, b) => a.phase - b.phase) })}><Plus size={17} />添加一集</button>
      </section><nav className={styles.phaseRail} aria-label="起承转合">{phases.map((name, index) => <button type="button" key={name} aria-pressed={phase === index} className={phase === index ? styles.selectedPhase : ""} onClick={() => setPhase(index)}><span>{name}</span><strong>{draft.outlines.filter(item => item.phase === index).length || "-"}</strong></button>)}</nav></div>}
      {step === 4 && (!episode ? <section className={styles.emptyManuscript}><FileText size={72} strokeWidth={1.15} /><p>点击按钮创建新集，AI辅助您生成初稿</p><button type="button" className={styles.whiteButton} onClick={addEpisode}>创建新集</button></section> : <div className={styles.manuscriptLayout}><section className={styles.manuscript}><div className={styles.manuscriptHeading}><input aria-label="本集标题" value={episode.title} maxLength={80} onChange={e => edit({ episodes: draft.episodes.map(item => item.id === episode.id ? { ...item, title: e.target.value } : item) })} />{aiButton("AI生成本集")}</div><textarea aria-label="剧本正文" value={episode.text} maxLength={150000} onChange={e => edit({ episodes: draft.episodes.map(item => item.id === episode.id ? { ...item, text: e.target.value } : item) })} placeholder={"场1 地点 日 内\n出场人物：\n\n写下人物的行动与对白……"} /><div className={styles.manuscriptFooter}>{Array.from(episode.text).length} 字<span>目标 {draft.words} 字</span></div></section><nav className={styles.episodeRail} aria-label="正文目录">{draft.episodes.map((item, index) => <button type="button" key={item.id} className={item.id === episode.id ? styles.selectedEpisode : ""} aria-pressed={item.id === episode.id} onClick={() => setEpisodeId(item.id)}><span>{String(index + 1).padStart(2, "0")}</span>{item.title}</button>)}<button type="button" onClick={addEpisode}><Plus size={18} />创建新集</button></nav></div>)}
      {children}
    </main>
    <dialog className={styles.dialog} ref={dialogRef} onCancel={() => setModal(null)} onClick={e => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) setModal(null); } }} aria-labelledby="preview-dialog-title"><button type="button" className={styles.closeDialog} aria-label="关闭弹窗" onClick={() => setModal(null)}><X size={20} /></button>
      {modal === "words" ? <><h2 id="preview-dialog-title">正文字数</h2><p>设置每集正文的目标字数，已写内容会保留。</p><label className={styles.field}>每集目标字数<input type="number" min={300} max={3000} value={wordInput} onChange={e => setWordInput(e.target.value)} /></label><button type="button" className={styles.whiteButton} disabled={!Number.isInteger(Number(wordInput)) || Number(wordInput) < 300 || Number(wordInput) > 3000} onClick={() => { edit({ words: Number(wordInput) }); setModal(null); }}>保存设置</button></> : modal === "delete" ? <><h2 id="preview-dialog-title">删除角色</h2><p>删除“{person?.name || "未命名角色"}”及其小传？删除后可以用顶部撤销按钮恢复。</p><div className={styles.dialogActions}><button type="button" className={styles.toolButton} onClick={() => setModal(null)}>取消</button><button type="button" className={styles.whiteButton} onClick={() => { edit({ characters: draft.characters.filter(item => item.id !== person?.id) }); setPersonId(""); setModal(null); }}>确认删除</button></div></> : <><Sparkles size={29} className={styles.dialogSparkle} /><h2 id="preview-dialog-title">{modal === "inspiration" ? "灵感策划" : modal === "translate" ? "对白翻译" : "AI 创作"}</h2><p>当前是根据截图复现的本地界面预览，此功能尚未接入 AI 服务。你可以先手动填写，体验四个步骤的布局和编辑效果。</p><button type="button" className={styles.whiteButton} onClick={() => setModal(null)}>继续手动创作</button></>}
    </dialog>
  </div>;
}

function TagPicker({ label, max, placeholder, options, value, onChange }: { label: string; max: number; placeholder: string; options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `preview-options-${label}`;
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (!ref.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const choices = [...new Set([...options, ...(query.trim() ? [query.trim()] : [])])].filter(text => text.includes(query.trim()));
  function select(text: string) {
    if (value.includes(text)) onChange(value.filter(item => item !== text));
    else if (value.length < max) onChange([...value, text]);
    else { setError(`最多选择${max}项`); return; }
    setError(""); setQuery(""); inputRef.current?.focus();
  }
  return <div className={styles.tagPicker} ref={ref} onKeyDown={e => { if (e.key === "Escape") { setOpen(false); inputRef.current?.focus(); } }}><label className={styles.field} htmlFor={`preview-tags-${label}`}><span>{label} <b>*</b>（不超过{max}个）</span></label><div className={styles.tagControl} onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
    <div className={styles.tagValues}>{value.map(text => <span key={text} className={styles.tag}>{text}<button type="button" aria-label={`移除${label}：${text}`} onClick={e => { e.stopPropagation(); onChange(value.filter(item => item !== text)); setError(""); }}><X size={12} /></button></span>)}<input id={`preview-tags-${label}`} ref={inputRef} aria-label={label} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} value={query} placeholder={!value.length ? placeholder : ""} onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true); }} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); const target = query.trim() || choices[0]; if (target) select(target); } if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()); } }} /></div><button type="button" aria-label={`${open ? "收起" : "展开"}${label}选项`} onClick={e => { e.stopPropagation(); setOpen(!open); }}><ChevronDown size={21} /></button></div>
    {error && <small className={styles.tagError} role="status">{error}</small>}
    {open && <div id={listId} className={styles.tagOptions} role="listbox" aria-label={`${label}选项`} aria-multiselectable="true">{choices.map((text, index) => <button type="button" role="option" aria-selected={value.includes(text)} key={text} onClick={() => select(text)} onKeyDown={e => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const items = ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]'); if (items?.length) items[(index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); } }}><span>{!options.includes(text) ? `添加“${text}”` : text}</span>{value.includes(text) && <Check size={15} />}</button>)}</div>}
  </div>;
}
