"use client";

import { useState } from "react";
import { ContactRound, Minus, Plus, Trash2, UserPlus, X } from "lucide-react";
import { newCharacter, parseCharacters, serializeCharacters, type CharacterCard } from "@/lib/studio/characters";
import styles from "./characters.module.css";

export function CharacterEditor({ value, disabled = false, onChange, onGenerate, generating = false }: { value: string; disabled?: boolean; onChange: (text: string) => void; onGenerate?: () => void; generating?: boolean }) {
  const cards = parseCharacters(value);
  const [selected, setSelected] = useState(0);
  const [raw, setRaw] = useState(false);
  const [trait, setTrait] = useState("");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const index = Math.min(selected, Math.max(0, cards.length - 1));
  const card = cards[index];
  function commit(next: CharacterCard[]) {
    const text = serializeCharacters(next);
    if (Array.from(text).length > 50000) { setError("人物小传总长度不能超过50,000字，请精简或导出备份后整理。"); return false; }
    setError(""); onChange(text); return true;
  }
  function update(patch: Partial<CharacterCard>) {
    return commit(cards.map((item, i) => i === index ? { ...item, ...patch, source: undefined } : item));
  }
  function addTrait() {
    if (!card || !trait.trim()) return;
    if (update({ traits: [...new Set([...card.traits, trait.trim()])] })) setTrait("");
  }
  function select(next: number) { setSelected(next); setTrait(""); setRemoving(false); setError(""); }
  return <div className={styles.editor}>
    {raw ? <label className={styles.raw}>人物小传全文<textarea disabled={disabled} rows={20} maxLength={50000} value={value} onChange={event => onChange(event.target.value)} /><small>全文与卡片使用同一份内容，未修改的原文完整保留。</small></label> : <div className={styles.layout}>
      <section className={`${styles.details} ${!card ? styles.emptyDetails : ""}`} aria-label="当前人物详情">
        {!card ? <div className={styles.empty}><ContactRound size={66} strokeWidth={1.25} /><p>点击右侧按钮创建新角色，自定义角色信息<br />或由 AI 一键生成所有角色</p><button className={styles.generate} type="button" disabled={disabled || generating || !onGenerate} aria-busy={generating} onClick={onGenerate}>{generating ? "正在生成…" : "一键生成"}</button></div> : <>
          <div className={styles.identity}><label>姓名<input disabled={disabled} maxLength={80} value={card.name} onChange={e => update({ name: e.target.value })} /></label><label>定位<input disabled={disabled} list="character-roles" maxLength={80} value={card.role} onChange={e => update({ role: e.target.value })} placeholder="主角 / 对手 / 盟友" /><datalist id="character-roles">{["主角", "男主", "女主", "反派", "配角", "盟友", "视角人物"].map(role => <option key={role} value={role} />)}</datalist></label>
            <label>年龄<div className={styles.age}><button type="button" aria-label="年龄减一" disabled={disabled || !/^\d{1,3}$/.test(card.age) || Number(card.age) <= 0} onClick={() => update({ age: String(Number(card.age) - 1) })}><Minus size={16} /></button><input aria-label="年龄" disabled={disabled} maxLength={40} value={card.age} placeholder="未设定" onChange={e => update({ age: e.target.value })} /><button type="button" aria-label="年龄加一" disabled={disabled || !/^\d{1,3}$/.test(card.age) || Number(card.age) >= 999} onClick={() => update({ age: String(Number(card.age) + 1) })}><Plus size={16} /></button></div></label></div>
          <div className={styles.traits}><span>性格</span><div className={styles.traitBox}><div className={styles.chips}>{card.traits.map((text, i) => <span key={`${i}:${text}`} className={styles.chip}>{text}<button type="button" disabled={disabled} aria-label={`移除性格：${text}`} onClick={() => update({ traits: card.traits.filter((_, n) => n !== i) })}><X size={12} /></button></span>)}</div><div className={styles.traitInput}><input aria-label="添加性格标签" value={trait} disabled={disabled} maxLength={200} placeholder="输入性格，回车添加" onChange={e => setTrait(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); addTrait(); } }} onBlur={addTrait} /><button type="button" disabled={disabled || !trait.trim()} onClick={addTrait} aria-label="添加性格标签"><Plus size={17} /></button></div></div></div>
          <label>背景<textarea disabled={disabled} rows={10} value={card.background} onChange={e => update({ background: e.target.value })} placeholder="身份、经历、欲望、弱点与成长……" /></label>
          <label>人物关系<textarea disabled={disabled} rows={4} value={card.relationships} onChange={e => update({ relationships: e.target.value })} placeholder="与谁亲近、信任谁、和谁对立？" /></label>
          {!card.source?.startsWith("【人物：") && card.source && <p className={styles.hint}>旧版文字完整保留在背景中，可逐人整理，也可切换全文编辑。</p>}
          <div className={styles.delete}>{removing ? <><span>删除“{card.name || "未命名角色"}”及其小传？</span><button type="button" disabled={disabled} onClick={() => { if (commit(cards.filter((_, i) => i !== index))) select(Math.max(0, index - 1)); }}>确认删除</button><button type="button" onClick={() => setRemoving(false)}>取消</button></> : <button type="button" disabled={disabled} onClick={() => setRemoving(true)}><Trash2 size={14} /> 删除此角色</button>}</div>
        </>}
      </section>
      <div className={styles.cards} role="group" aria-label="角色列表">{cards.map((item, i) => <button type="button" className={`${styles.card} ${i === index ? styles.selected : ""}`} aria-pressed={i === index} key={i} disabled={disabled} onClick={() => select(i)}><strong>{item.name || "未命名角色"}</strong>{item.role && <small>{item.role}</small>}</button>)}<button type="button" className={`${styles.card} ${styles.add}`} aria-label={cards.length ? "添加角色" : "添加第一位角色"} title="添加角色" disabled={disabled} onClick={() => { if (commit([...cards, newCharacter()])) select(cards.length); }}><UserPlus size={40} strokeWidth={1.5} /></button></div>
    </div>}
    <div className={styles.toolbar}><span>{cards.length} 位人物</span><button type="button" disabled={disabled} aria-pressed={raw} onClick={() => { setRaw(!raw); setTrait(""); setRemoving(false); }}>切换{raw ? "卡片" : "全文"}编辑</button></div>
    {error && <p className="studio-error" role="alert">{error}</p>}
  </div>;
}
