"use client";
import { useUI } from "@/lib/i18n/provider";
import type { Market } from "@/lib/i18n/config";


import { defaultNovelSettings, defaultDramaSettings } from "@/lib/studio/writing";
import type { ContentType, NovelSettings, DramaSettings } from "@/lib/studio/api";
import styles from "./writing-options.module.css";

type SettingsPatch = { novel_settings: NovelSettings; drama_settings: null } | { drama_settings: DramaSettings; novel_settings: null };

export function WritingOptions({ kind, market, novel, drama, disabled = false, onChange }: {
  kind: ContentType; market?: Market; novel?: NovelSettings | null; drama?: DramaSettings | null; disabled?: boolean; onChange: (patch: SettingsPatch) => void;
}) {
  const ui = useUI();
  const n = { ...defaultNovelSettings, ...novel };
  const d = { ...defaultDramaSettings, ...drama };
  const changeNovel = (patch: Partial<NovelSettings>) => onChange({ novel_settings: { ...n, ...patch }, drama_settings: null });
  const changeDrama = (patch: Partial<DramaSettings>) => onChange({ drama_settings: { ...d, ...patch }, novel_settings: null });
  return <section className={styles.options}><h3>{ui(kind === "novel" ? "小说叙事设置" : "短剧拍摄与节奏")}</h3>
    {kind === "novel" ? <div className={styles.grid}>
      <label>{ui("作品形态")}<select value={n.form} disabled={disabled} onChange={e => changeNovel({ form: e.target.value as NovelSettings["form"] })}><option value="serial">{ui("连载／长篇小说")}</option><option value="short_story">{ui("短篇／中篇故事")}</option></select></label>
      <label>{ui("叙事视角")}<select value={n.perspective} disabled={disabled} onChange={e => changeNovel({ perspective: e.target.value as NovelSettings["perspective"] })}><option value="third_limited">{ui("第三人称有限视角")}</option><option value="first_person">{ui("第一人称主角视角")}</option><option value="omniscient">{ui("第三人称全知视角")}</option><option value="multiple">{ui("多人物视角")}</option></select></label>
      <label>{ui("叙事文风")}<select value={n.prose_style} disabled={disabled} onChange={e => changeNovel({ prose_style: e.target.value as NovelSettings["prose_style"] })}><option value="natural">{ui("自然流畅")}</option><option value="immersive">{ui("细腻沉浸")}</option><option value="literary">{ui("文学质感")}</option><option value="light">{ui("轻松鲜活")}</option></select></label>
      <label>{ui("叙事节奏")}<select value={n.pacing} disabled={disabled} onChange={e => changeNovel({ pacing: e.target.value as NovelSettings["pacing"] })}><option value="balanced">{ui("情节与描写平衡")}</option><option value="fast">{ui("快速推进")}</option><option value="slow_burn">{ui("慢热铺陈")}</option></select></label>
    </div> : <div className={styles.grid}>
      <label>{ui("画幅形式")}<select value={d.format} disabled={disabled} onChange={e => changeDrama({ format: e.target.value as DramaSettings["format"] })}><option value="vertical_short">{ui("竖屏短剧")}</option><option value="horizontal_short">{ui("横屏短剧")}</option></select></label>
      <label>{ui("单集目标时长")}<select value={d.minutes_per_episode} disabled={disabled} onChange={e => changeDrama({ minutes_per_episode: Number(e.target.value) })}>{[...new Set([1, 2, 3, 5, 10, 15, d.minutes_per_episode])].sort((a, b) => a - b).map(m => <option value={m} key={m}>{ui(m)} {ui(" 分钟")}</option>)}</select></label>
      <label>{ui("场景密度")}<select value={d.scene_density} disabled={disabled} onChange={e => changeDrama({ scene_density: e.target.value as DramaSettings["scene_density"] })}><option value="compact">{ui("集中场景，精简转场")}</option><option value="balanced">{ui("适量场景，冲突集中")}</option><option value="multi_scene">{ui("多场景交叉推进")}</option></select></label>
      <label>{ui("集尾钩子")}<select value={d.hook_style} disabled={disabled} onChange={e => changeDrama({ hook_style: e.target.value as DramaSettings["hook_style"] })}><option value="reversal">{ui(market === "taiwan" ? "证据反转／关系秘密" : "反转／身份揭示")}</option><option value="suspense">{ui("悬念／危机升级")}</option><option value="emotional">{ui(market === "taiwan" ? "关系抉择／行动代价" : "情感抉择／情绪悬点")}</option></select></label>
    </div>}
  </section>;
}
