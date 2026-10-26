"use client";

import Link, { useLinkStatus } from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { BookOpen, FileText, Globe2, Library, Settings2, SquarePen } from "lucide-react";

const ModelSettings = dynamic(() => import("./model-settings").then(module => module.ModelSettings));

function NavigationHint() {
  const { pending } = useLinkStatus();
  return <span className={`studio-navigation-hint ${pending ? "is-pending" : ""}`} aria-hidden="true" />;
}

export function StudioNav({ selected = "" }: { selected?: string }) {
  const [model, setModel] = useState(false);
  const [open, setOpen] = useState(false);
  const items = [
    ["/workspace", "我的作品", FileText], ["/studio/scripts/new", "剧本创作", SquarePen],
    ["/studio/novels/new", "小说创作", BookOpen], ["/worlds", "世界模型", Globe2], ["/corpus", "语料参考", Library],
  ] as const;
  return <aside className={`studio-sidebar plotloom-nav ${open ? "is-open" : ""}`}><div className="sidebar-label">PLOTLOOM · 中文创作</div>
    <button className="plotloom-nav-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "收起导航" : "展开导航"} · {selected || "创作空间"}</button>
    {items.map(([href, label, Icon]) => <Link key={href} href={href} prefetch={true} aria-current={selected === label ? "page" : undefined} className={`sidebar-link ${selected === label ? "selected" : ""}`}><Icon size={18} />{label}<NavigationHint /></Link>)}
    <button className="sidebar-link" onClick={() => setModel(true)}><Settings2 size={18} />模型信息</button>
    <p className="studio-hint">公开创作空间<br />访客共享作品与世界库</p>
    {model && <ModelSettings onClose={() => setModel(false)} />}
  </aside>;
}
