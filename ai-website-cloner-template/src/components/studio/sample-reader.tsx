import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Clapperboard } from "lucide-react";
import { Header } from "@/components/sites/storyplay/shared";
import { StudioNav } from "./navigation";
import { sampleCharacterCount, sampleCreationHref, worldLabels, type OfficialSample } from "@/content/samples";
import "./samples.css";

export function SampleReader({ sample }: { sample: OfficialSample }) {
  const work = sample.work;
  const novel = work.content_type === "novel";
  const Icon = novel ? BookOpen : Clapperboard;
  const unit = novel ? "章" : "集";
  const creationHref = sampleCreationHref(sample);
  return <div className="workspace-page"><Header workspace /><div className="plotloom-shell"><StudioNav selected="官方样例" /><main className="plotloom-main sample-reader">
    <Link className="sample-back" href={`/samples?type=${work.content_type}`}><ArrowLeft size={15} />返回{novel ? "小说" : "剧本"}样例</Link>
    <header className={`sample-reader-heading ${novel ? "is-novel" : "is-drama"}`}><span className="sample-eyebrow"><Icon size={16} /> 官方{novel ? "小说" : "剧本"}样例</span><h1>{work.title}</h1><p>{sample.logline}</p><div className="sample-tags"><span>{work.genre}</span><span>完整{work.units}{unit}</span><span>正文约 {sampleCharacterCount(sample).toLocaleString("zh-CN")} 字</span><span>AI辅助创作</span></div>
      <div className="sample-reader-actions"><a className="outline-button" href={`/samples/${sample.slug}/download`} download><ArrowDownToLine size={15} />下载完整 TXT</a><Link className="pill light" href={creationHref}>用此设定开始创作 <ArrowRight size={15} /></Link></div>
      {sample.reference && <p className="sample-reference">题材参考：<a href={sample.reference.url} target="_blank" rel="noopener noreferrer">红果热播总榜 · {sample.reference.date} · 第{sample.reference.rank}名《{sample.reference.title}》</a><span>参考题材方向，人物与故事独立创作。</span></p>}
    </header>
    <div className="sample-reading-layout"><aside className="sample-contents" aria-label="样例目录"><span>阅读目录</span><a href="#setting">01 故事设定</a><a href="#characters">02 人物</a><a href="#outline">03 {novel ? "章节" : "分集"}大纲</a><a href="#manuscript">04 {novel ? "小说正文" : "分场剧本"}</a>{work.chapters.map(chapter => <a className="sample-chapter-link" key={chapter.number} href={`#chapter-${chapter.number}`}>第{chapter.number}{unit} · {chapter.title}</a>)}<a href="#notes">05 阅读提示</a></aside>
      <article className="sample-reading-body">
        <section id="setting" className="sample-section"><span className="sample-section-number">01 / STORY</span><h2>故事设定</h2><p className="sample-text">{work.premise}</p><dl className="sample-setting-grid"><div><dt>核心设定</dt><dd>{work.creative?.core?.join(" · ")}</dd></div><div><dt>风格</dt><dd>{work.creative?.styles?.join(" · ")}</dd></div><div className="sample-setting-wide"><dt>{novel ? "阅读看点" : "视觉与冲突亮点"}</dt><dd>{work.creative?.highlights}</dd></div><div className="sample-setting-wide"><dt>{novel ? "小说叙事" : "拍摄与节奏"}</dt><dd>{novel ? `${work.novel_settings?.perspective === "first_person" ? "第一人称" : "第三人称有限视角"} · 自然文风 · ${work.novel_settings?.pacing === "slow_burn" ? "慢热铺陈" : "均衡节奏"}` : `${work.drama_settings?.format === "vertical_short" ? "竖屏" : "横屏"}短剧 · 单集目标 ${work.drama_settings?.minutes_per_episode} 分钟 · 紧凑场景`}</dd></div></dl>
          <details className="sample-world"><summary>展开世界观与地点设定</summary><p>{work.world_snapshot?.description}</p>{Object.entries(work.world_snapshot?.sections || {}).map(([key, value]) => <div key={key}><h3>{worldLabels[key] || key}</h3><p className="sample-text">{value}</p></div>)}</details>
        </section>
        <section id="characters" className="sample-section"><span className="sample-section-number">02 / CHARACTERS</span><h2>{novel ? "人物档案" : "人物小传"}</h2><div className="sample-character-list">{work.characters.split("\n").map((text, index) => <p key={index}>{text}</p>)}</div></section>
        <section id="outline" className="sample-section"><span className="sample-section-number">03 / OUTLINE</span><h2>{novel ? "章节大纲" : "分集大纲"}</h2><div className="sample-outline">{work.outline.split("\n").map((text, index) => <p key={index}>{text}</p>)}</div></section>
        <section id="manuscript" className="sample-section"><span className="sample-section-number">04 / MANUSCRIPT</span><h2>{novel ? "小说正文" : "分场剧本"}</h2>{work.chapters.map(chapter => <section id={`chapter-${chapter.number}`} className={`sample-chapter ${novel ? "is-novel" : "is-drama"}`} key={chapter.number}><span>第{chapter.number}{unit}</span><h3>{chapter.title}</h3><div className="sample-prose">{chapter.content}</div></section>)}</section>
        <section id="notes" className="sample-section"><span className="sample-section-number">05 / WRITING NOTES</span><h2>带着这几个问题，再读一遍</h2><div className="sample-lessons">{sample.lessons.map((lesson, index) => <div key={lesson.title}><span>0{index + 1}</span><h3>{lesson.title}</h3><p>{lesson.text}</p></div>)}</div></section>
        <footer className="sample-reading-end"><h2>接下来，换你来写。</h2><p>将这份样例的故事设定带入表单，调整人物、冲突与世界观，确认后按流程创作。</p><Link className="pill light" href={creationHref}>用此设定开始创作 <ArrowRight size={15} /></Link><Link className="sample-back" href="/samples">再读一份样例</Link></footer>
      </article>
    </div>
  </main></div></div>;
}
