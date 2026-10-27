import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Header } from "@/components/sites/storyplay/shared";
import { StudioNav } from "@/components/studio/navigation";
import styles from "./tutorial.module.css";

export const metadata: Metadata = {
  title: "创作教程",
  description: "了解如何在 Plotloom 创建剧本或小说、生成并审阅内容。",
};

const steps = [
  { title: "选择创作类型", text: "进入剧本创作或小说创作，填写名称、故事想法和创作设定。也可以通过灵感创作描述一个念头，挑选并回填喜欢的方案。" },
  { title: "按步骤填写", text: "顶部四步导航在滚动时保持可见，点击即可切换故事设定、人物、大纲和正文。新建时也能先填写全部内容；人物可通过角色卡片逐一编辑背景、性格和人物关系。" },
  { title: "创建、生成和审阅", text: "点击“保存全部内容，创建作品”可先保存草稿。也可在某一步点击 AI 生成，系统先保存全部输入，再生成该步骤。创建后还可一键生成全部；生成稿需要审阅和采纳，才会写入作品。" },
  { title: "保存和管理", text: "作品保存在与当前浏览器关联的独立空间，可在“我的作品”中继续编辑、导出或归档。更换浏览器前，请先导出备份。" },
];

export default function TutorialPage() {
  return <div className="workspace-page"><Header workspace /><div className="plotloom-shell"><StudioNav /><main className={`plotloom-main ${styles.tutorial}`}>
    <div className={styles.heading}><span>CREATION GUIDE</span><h1>教程说明</h1><p>从一个想法开始，逐步完成你的剧本或小说。</p></div>
    <ol className={styles.steps}>{steps.map((step, index) => <li key={step.title}>
      <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
      <div><h2>{step.title}</h2><p>{step.text}</p></div>
    </li>)}</ol>
    <div className={styles.actions}><Link className="pill light" href="/studio/scripts/new">开始剧本创作 <ArrowRight size={16} /></Link><Link className="outline-button" href="/studio/novels/new">开始小说创作 <ArrowRight size={16} /></Link><Link href="/samples">先看看官方样例 →</Link></div>
  </main></div></div>;
}
