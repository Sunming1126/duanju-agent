"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BookOpen, ChevronLeft, ChevronRight, Globe2, SquarePen } from "lucide-react";
import { asset, dramas } from "./data";
import { Header, SectionHeading } from "./shared";

export function StoryplayHome() {
  const gallery = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const update = () => {
      const progress = Math.min(1, Math.max(0, window.scrollY / 620));
      gallery.current?.style.setProperty("--gallery-progress", String(progress));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return <div className="storyplay-home"><Header />
    <main>
      <section className="hero">
        <h2>短剧与小说创作平台</h2>
        <h1>让AI辅助故事创作者成为超级个体</h1>
        <p>从故事设定到正文，让灵感逐步成稿</p>
        <Link href="/workspace" className="pill light hero-cta">立即体验</Link>
        <div className="hero-tools" aria-label="主要创作功能">
          <Link href="/workspace?create=new"><SquarePen size={15} /> 新建剧本</Link><span />
          <Link href="/workspace?create=novel"><BookOpen size={15} /> 小说创作</Link><span />
          <Link href="/worlds"><Globe2 size={15} /> 世界设定</Link>
        </div>
      </section>
      <section className="lapian-section" aria-labelledby="lapian-heading">
        <header className="lapian-intro"><SectionHeading>创作灵感</SectionHeading>
          <p id="lapian-heading">海报为展示素材；实际语料请在语料参考中检索并核对来源。</p>
          <Link className="gold-button" href="/corpus">查看语料参考</Link>
        </header>
        <div ref={gallery} className="poster-stage"><div className="poster-grid" key={page}>
          {[...dramas.slice(page * 5), ...dramas.slice(0, page * 5)].map(drama => <Link className="poster" href="/corpus" key={drama.id} aria-label={`查看${drama.title}的拉片资料`}>
            <Image className="poster-image" src={asset(`cover-${String(drama.id).padStart(2, "0")}.jpg`)} alt={drama.title} width={400} height={572} priority={drama.id <= 5} />
            <Image className="poster-tag" src={asset(`${drama.tag}.png`)} alt={drama.tag === "hot" ? "爆款" : "新作"} width={44} height={52} />
            <span className="poster-overlay"><span>语料参考 <ArrowRight size={15} /></span></span>
          </Link>)}
        </div></div>
        <div className="gallery-paging"><button className="paging-arrow" disabled={page === 0} onClick={() => setPage(0)} aria-label="上一组海报"><ChevronLeft size={20} /></button>{[0,1].map(index => <button aria-label={`第${index + 1}组海报`} aria-pressed={page === index} key={index} className={`paging-dot ${page === index ? "active" : ""}`} onClick={() => setPage(index)} />)}<button className="paging-arrow" disabled={page === 1} onClick={() => setPage(1)} aria-label="下一组海报"><ChevronRight size={20} /></button></div>
      </section>
    </main>
  </div>;
}
