import Link from "next/link";
import { ArrowDownToLine, ArrowRight, BookOpen, Clapperboard } from "lucide-react";
import { Header } from "@/components/sites/storyplay/shared";
import { StudioNav } from "./navigation";
import { officialSamples, sampleCharacterCount } from "@/content/samples";
import type { ContentType } from "@/lib/studio/api";
import "./samples.css";

export function SampleLibrary({ kind }: { kind?: ContentType }) {
  const samples = officialSamples.filter(sample => !kind || sample.work.content_type === kind);
  return <div className="workspace-page"><Header workspace /><div className="plotloom-shell"><StudioNav selected="官方样例" /><main className="plotloom-main sample-library">
    <h1 className="sr-only">官方小说与剧本样例</h1>
    <nav className="sample-filters" aria-label="样例类型">{[["", "全部样例"], ["novel", "小说"], ["short_drama", "剧本"]].map(([value, label]) => <Link key={value} href={value ? `/samples?type=${value}` : "/samples"} aria-current={(kind || "") === value ? "page" : undefined}>{label}<span>{officialSamples.filter(sample => !value || sample.work.content_type === value).length}</span></Link>)}</nav>
    <div className="sample-grid">{samples.map(sample => {
      const novel = sample.work.content_type === "novel";
      const Icon = novel ? BookOpen : Clapperboard;
      return <article key={sample.slug} className={`sample-card ${novel ? "is-novel" : "is-drama"}`}>
        <Link className="sample-card-body" href={`/samples/${sample.slug}`}>
          <div className="sample-card-label"><span><Icon size={16} />{novel ? "短篇小说" : "短剧剧本"}</span><span>官方样例</span></div>
          <h2>{sample.work.title}</h2><p className="sample-logline">{sample.logline}</p>
          <div className="sample-tags"><span>{sample.work.genre}</span><span>{novel ? sample.work.novel_settings?.perspective === "first_person" ? "第一人称" : "第三人称" : sample.work.drama_settings?.format === "vertical_short" ? "竖屏短剧" : "横屏短剧"}</span><span>完整{sample.work.units}{novel ? "章" : "集"}</span></div>
          <div className="sample-card-learn"><span>这一份，可以学什么</span><p>{sample.lessons.map(lesson => lesson.title).join(" · ")}</p></div>
          <div className="sample-card-footer"><span>正文约 {sampleCharacterCount(sample).toLocaleString("zh-CN")} 字</span><strong>开始阅读 <ArrowRight size={15} /></strong></div>
        </Link>
        <a className="sample-card-download" href={`/samples/${sample.slug}/download`} download><ArrowDownToLine size={14} />下载完整 TXT 文档</a>
      </article>;
    })}</div>
  </main></div></div>;
}
