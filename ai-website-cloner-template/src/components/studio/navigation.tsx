"use client";
import { useUI } from "@/lib/i18n/provider";


import Link, { useLinkStatus } from "next/link";
import { useState } from "react";
import { BookOpen, FileText, Globe2, Library, SquarePen, BookMarked, UserRound } from "lucide-react";

function NavigationHint() {
  const { pending } = useLinkStatus();
  return <span className={`studio-navigation-hint ${pending ? "is-pending" : ""}`} aria-hidden="true" />;
}

export function StudioNav({ selected = "" }: { selected?: string }) {
  const ui = useUI();
  const [open, setOpen] = useState(false);
  const items = [
    ["/workspace", "我的作品", FileText], ["/studio/scripts/new", "剧本创作", SquarePen],
    ["/studio/novels/new", "小说创作", BookOpen], ["/samples", "官方样例", BookMarked], ["/worlds", "世界模型", Globe2], ["/corpus", "语料参考", Library], ["/account", "我的空间", UserRound],
  ] as const;
  return <aside className={`studio-sidebar plotloom-nav ${open ? "is-open" : ""}`}><div className="sidebar-label">{ui("PLOTLOOM · 中文创作")}</div>
    <button className="plotloom-nav-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{ui(open ? "收起导航" : "展开导航")} {ui(" · ")}{ui(selected || "创作空间")}</button>
    {items.map(([href, label, Icon]) => <Link key={href} href={href} prefetch={true} aria-current={selected === label ? "page" : undefined} className={`sidebar-link ${selected === label ? "selected" : ""}`}><Icon size={18} />{ui(label)}<NavigationHint /></Link>)}
    <p className="studio-hint">{ui("独立创作空间")}<br />{ui("作品与世界仅自己可见")}</p>
  </aside>;
}
