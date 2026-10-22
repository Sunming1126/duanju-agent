"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { asset, dramas } from "./data";
import { Header, Modal } from "./shared";

export function DramaLibrary() {
  const params = useSearchParams();
  const [selected, setSelected] = useState<number | null>(() => { const id = Number(params.get("detail")); return dramas.some(item => item.id === id) ? id : null; });
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("全部");
  const [tag, setTag] = useState("全部短剧");
  const shown = useMemo(() => dramas.filter(drama => drama.title.includes(query.trim()) && (genre === "全部" || drama.genre === genre) && (tag === "全部短剧" || (tag === "最新收录" ? drama.tag === "new" : drama.tag === "hot"))), [query,genre,tag]);
  const current = dramas.find(item => item.id === selected);
  return <div className="library-page"><Header workspace /><main className="library-main"><Link className="back-link" href="/"><ArrowLeft size={15} /> 返回首页</Link><div className="library-title"><div><span className="eyebrow gold">STORY IN EVERY FRAME</span><h1>短剧拉片</h1><p>从优秀故事中，发现你的创作灵感。</p></div><Link href="/workspace?create=new" className="pill light">开始创作 <ArrowRight size={16} /></Link></div>
    <div className="library-filters"><div className="genre-row"><span><SlidersHorizontal size={15} /> 题材</span>{["全部","都市","甜宠","古装","玄幻","家庭"].map(item => <button key={item} className={genre === item ? "active" : ""} onClick={() => setGenre(item)}>{item}</button>)}</div><div className="library-toolbar"><div className="works-filters">{["全部短剧","最新收录","爆款精选"].map(item => <button className={tag === item ? "active" : ""} key={item} onClick={() => setTag(item)}>{item}</button>)}</div><label className="search-field"><Search size={16} /><input aria-label="搜索短剧" placeholder="搜索短剧名称" value={query} onChange={event=>setQuery(event.target.value)} /></label></div></div>
    <div className="library-results"><span>共 {shown.length} 部短剧</span><span>原站公开海报 · 本地筛选演示</span></div>
    {shown.length ? <div className="library-grid">{shown.map(drama => <button key={drama.id} className="library-card" onClick={() => setSelected(drama.id)}><div className="library-poster"><Image src={asset(`cover-${String(drama.id).padStart(2,"0")}.jpg`)} alt={drama.title} width={400} height={572} /><Image className="poster-tag" src={asset(`${drama.tag}.png`)} alt={drama.tag === "new" ? "新作" : "爆款"} width={44} height={52} /><span className="poster-overlay"><span>查看资料 <ChevronRight size={16} /></span></span></div><h2>{drama.title}</h2><p>{drama.genre}<span>查看资料 <ArrowRight size={12} /></span></p></button>)}</div> : <div className="empty-workspace"><Search size={34} /><h2>没有找到相关短剧</h2><p>试试其他题材或关键词。</p><button className="outline-button" onClick={()=>{setQuery("");setGenre("全部");setTag("全部短剧");}}>清除筛选</button></div>}
    <p className="workspace-disclaimer">海报来自原站公开首页；分类为预览示例，未接入实时数据及剧本拆解服务。</p>
    </main>{current && <Modal title="短剧资料" wide onClose={()=>setSelected(null)}><div className="drama-detail"><Image src={asset(`cover-${String(current.id).padStart(2,"0")}.jpg`)} alt={current.title} width={400} height={572} /><div><span className="detail-tag">{current.tag === "hot" ? "爆款精选" : "最新收录"}</span><h2>{current.title}</h2><p>{current.genre} · 短剧参考</p><div className="detail-description"><h3>拉片资料</h3><p>当前可浏览原站公开海报。分集剧情、人物分析与拆解内容尚未接入。</p></div><Link className="pill light" href="/workspace?create=new">创建自己的故事 <ArrowRight size={15} /></Link></div></div></Modal>}
  </div>;
}
