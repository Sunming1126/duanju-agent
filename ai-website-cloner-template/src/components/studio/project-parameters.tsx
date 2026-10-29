"use client";

import Link from "next/link";
import { ChevronDown, Download, Plus, Save } from "lucide-react";
import type { ContentType, Section, World, WorldInput } from "@/lib/studio/api";
import type { ProjectSettingsValue } from "@/lib/studio/project";
import { dramaGenres, novelGenres } from "@/lib/studio/writing";
import { WritingOptions } from "./writing-options";
import styles from "./parameters.module.css";

export function ProjectParameters({ type, value, worlds, sections = [], worldId, disabled = false, onChange, onWorldChange, onSaveWorld, onExportWorld }: {
  type: ContentType; value: ProjectSettingsValue; worlds: World[]; sections?: Section[]; worldId?: string | null; disabled?: boolean;
  onChange: (patch: Partial<ProjectSettingsValue>) => void;
  onWorldChange: (world: WorldInput, sourceId?: string) => void;
  onSaveWorld?: () => void; onExportWorld?: () => void;
}) {
  const world = value.world_snapshot;
  const genres = type === "novel" ? novelGenres : dramaGenres;
  function editWorld(patch: Partial<WorldInput>) {
    if (!disabled) onWorldChange({ name: world?.name || "作品专属世界", description: world?.description || "", sections: world?.sections || {}, ...patch });
  }
  return <div className={styles.layout}>
    <section className={styles.card} aria-label="创作参数">
      <h2>创作参数</h2>
      <div className={styles.grid}>
        <label>计划{type === "novel" ? "章节" : "集数"}<input name="units" type="number" min={1} max={200} required disabled={disabled} value={value.units} onChange={event => onChange({ units: event.target.value })} /></label>
        <label>{type === "novel" ? "每章目标字数" : "每集剧本字数"}<input name="words" type="number" min={300} max={type === "novel" ? 6000 : 3000} required disabled={disabled} value={value.words_per_chapter} onChange={event => onChange({ words_per_chapter: event.target.value })} /></label>
        <label className={styles.wide}>{type === "novel" ? "小说主分类" : "短剧题材"}<select name="genre" disabled={disabled} value={value.genre} onChange={event => onChange({ genre: event.target.value })}>{[...new Set([value.genre, ...genres])].map(genre => <option key={genre} value={genre}>{genre || "请选择"}</option>)}</select></label>
      </div>
      <div className={styles.writing}><WritingOptions kind={type} novel={value.novel_settings} drama={value.drama_settings} disabled={disabled} onChange={onChange} /></div>
    </section>
    <section className={styles.card} aria-label="作品世界">
      <header className={styles.heading}><h2>作品世界</h2><div className={styles.actions}>
        {!world && <button type="button" disabled={disabled} onClick={() => editWorld({})}><Plus size={16} />新建作品专属世界</button>}
        {world && onSaveWorld && <button type="button" disabled={disabled} onClick={onSaveWorld}><Save size={16} />另存世界库</button>}
        {world && onExportWorld && <button type="button" onClick={onExportWorld}><Download size={16} />导出副本</button>}
      </div></header>
      <label>从世界库复制<select disabled={disabled} value={worldId || ""} onChange={event => {
        const item = worlds.find(world => world.id === event.target.value);
        if (item && !disabled) onWorldChange({ name: item.name, description: item.description, sections: { ...item.sections } }, item.id);
      }}><option value="">{world ? "使用作品专属世界" : "选择世界库原件"}</option>{worlds.map(item => <option value={item.id} key={item.id}>{item.name} · v{item.revision}</option>)}</select></label>
      <div className={styles.worldOverview}>
        <label>世界名称<input maxLength={80} disabled={disabled} value={world?.name || ""} placeholder="为故事的世界起个名字" onChange={event => editWorld({ name: event.target.value })} /></label>
        <label>世界观<textarea aria-label="世界观" rows={4} maxLength={5000} disabled={disabled} value={world?.description || ""} placeholder="故事发生在怎样的世界？写下它的背景、规则与独特之处。" onChange={event => editWorld({ description: event.target.value })} /></label>
      </div>
      {world && <div className={styles.sections}>{sections.map(section => <details key={section.id} className={styles.section}>
        <summary><span>{section.label}</span><ChevronDown size={18} /></summary>
        <div>{section.fields.map(field => <label key={field.key}>{field.label}<textarea aria-label={field.label} rows={4} maxLength={20000} disabled={disabled} value={world.sections[field.key] || ""} onChange={event => editWorld({ sections: { ...world.sections, [field.key]: event.target.value } })} /></label>)}</div>
      </details>)}</div>}
      <div className={styles.footer}><Link href="/worlds">管理世界库 →</Link></div>
    </section>
  </div>;
}
