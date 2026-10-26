"use client";

import { defaultNovelSettings, defaultDramaSettings } from "@/lib/studio/writing";
import type { ContentType, NovelSettings, DramaSettings } from "@/lib/studio/api";

type SettingsPatch = { novel_settings: NovelSettings; drama_settings: null } | { drama_settings: DramaSettings; novel_settings: null };

export function WritingOptions({ kind, novel, drama, disabled = false, onChange }: {
  kind: ContentType; novel?: NovelSettings | null; drama?: DramaSettings | null; disabled?: boolean; onChange: (patch: SettingsPatch) => void;
}) {
  const n = { ...defaultNovelSettings, ...novel };
  const d = { ...defaultDramaSettings, ...drama };
  const changeNovel = (patch: Partial<NovelSettings>) => onChange({ novel_settings: { ...n, ...patch }, drama_settings: null });
  const changeDrama = (patch: Partial<DramaSettings>) => onChange({ drama_settings: { ...d, ...patch }, novel_settings: null });
  return <section className="writing-options"><div><h3>{kind === "novel" ? "小说叙事设置" : "短剧拍摄与节奏"}</h3><p className="studio-hint">{kind === "novel" ? "确定谁在讲述故事，以及读者会感受到的语言和节奏。正文采用连续叙事与自然对白。" : "围绕可拍摄场景、人物行动与对白推进冲突，并在每集结尾留下钩子。"}</p></div>
    {kind === "novel" ? <div className="writing-option-grid">
      <label>作品形态<select value={n.form} disabled={disabled} onChange={e => changeNovel({ form: e.target.value as NovelSettings["form"] })}><option value="serial">连载／长篇小说</option><option value="short_story">短篇／中篇故事</option></select></label>
      <label>叙事视角<select value={n.perspective} disabled={disabled} onChange={e => changeNovel({ perspective: e.target.value as NovelSettings["perspective"] })}><option value="third_limited">第三人称有限视角</option><option value="first_person">第一人称主角视角</option><option value="omniscient">第三人称全知视角</option><option value="multiple">多人物视角</option></select></label>
      <label>叙事文风<select value={n.prose_style} disabled={disabled} onChange={e => changeNovel({ prose_style: e.target.value as NovelSettings["prose_style"] })}><option value="natural">自然流畅</option><option value="immersive">细腻沉浸</option><option value="literary">文学质感</option><option value="light">轻松鲜活</option></select></label>
      <label>叙事节奏<select value={n.pacing} disabled={disabled} onChange={e => changeNovel({ pacing: e.target.value as NovelSettings["pacing"] })}><option value="balanced">情节与描写平衡</option><option value="fast">快速推进</option><option value="slow_burn">慢热铺陈</option></select></label>
    </div> : <div className="writing-option-grid">
      <label>画幅形式<select value={d.format} disabled={disabled} onChange={e => changeDrama({ format: e.target.value as DramaSettings["format"] })}><option value="vertical_short">竖屏短剧</option><option value="horizontal_short">横屏短剧</option></select></label>
      <label>单集目标时长<select value={d.minutes_per_episode} disabled={disabled} onChange={e => changeDrama({ minutes_per_episode: Number(e.target.value) })}>{[...new Set([1, 2, 3, 5, 10, 15, d.minutes_per_episode])].sort((a, b) => a - b).map(m => <option value={m} key={m}>{m} 分钟</option>)}</select></label>
      <label>场景密度<select value={d.scene_density} disabled={disabled} onChange={e => changeDrama({ scene_density: e.target.value as DramaSettings["scene_density"] })}><option value="compact">集中场景，精简转场</option><option value="balanced">适量场景，冲突集中</option><option value="multi_scene">多场景交叉推进</option></select></label>
      <label>集尾钩子<select value={d.hook_style} disabled={disabled} onChange={e => changeDrama({ hook_style: e.target.value as DramaSettings["hook_style"] })}><option value="reversal">反转／身份揭示</option><option value="suspense">悬念／危机升级</option><option value="emotional">情感抉择／情绪悬点</option></select></label>
    </div>}
  </section>;
}
