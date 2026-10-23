"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowRight, BookOpen, ChevronLeft, ChevronRight, Globe2, Sparkles, SquarePen } from "lucide-react";
import { asset, dramas } from "./data";
import { Header, Logo, SectionHeading } from "./shared";

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
        <p>真人、AI短剧<span className="fire">🔥</span>剧本创作效率提升10倍！</p>
        <Link href="/workspace" className="pill light hero-cta">立即体验</Link>
        <div className="hero-tools" aria-label="主要创作功能">
          <Link href="/workspace?create=new"><SquarePen size={15} /> 新建剧本</Link><span />
          <Link href="/workspace?create=novel"><BookOpen size={15} /> 小说创作</Link><span />
          <Link href="/worlds"><Globe2 size={15} /> 世界设定</Link>
        </div>
      </section>
      <section className="lapian-section" aria-labelledby="lapian-heading">
        <header className="lapian-intro"><SectionHeading>短剧拉片</SectionHeading>
          <p id="lapian-heading">无需看短剧视频，整合各平台的累积播放量、热力值等实时数据，筛选热门题材下的优<br className="desktop-break" />质短剧，进行剧本拆解，为编剧实现一键拉片</p>
          <Link className="gold-button" href="/corpus">查看本机语料</Link>
        </header>
        <div ref={gallery} className="poster-stage"><div className="poster-grid" key={page}>
          {[...dramas.slice(page * 5), ...dramas.slice(0, page * 5)].map(drama => <Link className="poster" href={`/lapian?detail=${drama.id}`} key={drama.id} aria-label={`查看${drama.title}的拉片资料`}>
            <Image className="poster-image" src={asset(`cover-${String(drama.id).padStart(2, "0")}.jpg`)} alt={drama.title} width={400} height={572} priority={drama.id <= 5} />
            <Image className="poster-tag" src={asset(`${drama.tag}.png`)} alt={drama.tag === "hot" ? "爆款" : "新作"} width={44} height={52} />
            <span className="poster-overlay"><span>查看拉片 <ArrowRight size={15} /></span></span>
          </Link>)}
        </div></div>
        <div className="gallery-paging"><button className="paging-arrow" disabled={page === 0} onClick={() => setPage(0)} aria-label="上一组海报"><ChevronLeft size={20} /></button>{[0,1].map(index => <button aria-label={`第${index + 1}组海报`} aria-pressed={page === index} key={index} className={`paging-dot ${page === index ? "active" : ""}`} onClick={() => setPage(index)} />)}<button className="paging-arrow" disabled={page === 1} onClick={() => setPage(1)} aria-label="下一组海报"><ChevronRight size={20} /></button></div>
      </section>
      <section className="feature-entries" aria-label="创作入口">
        <Link href="/workspace?create=novel"><span className="feature-icon violet"><BookOpen size={22} /></span><h2>小说创作</h2><ArrowRight size={20} /></Link>
        <Link href="/workspace?create=inspiration"><span className="feature-icon pink"><Sparkles size={22} /></span><h2>灵感策划</h2><ArrowRight size={20} /></Link>
        <Link href="/workspace?create=new"><span className="feature-icon cyan"><SquarePen size={22} /></span><h2>剧本创作</h2><ArrowRight size={20} /></Link>
      </section>
      <section className="provider-strip" aria-label="原站展示的平台"><div>{Array.from({length: 14}, (_, i) => <Image key={i} src={asset(`provider-${String(i + 1).padStart(2,"0")}.webp`)} alt={`原站平台标志 ${i + 1}`} width={150} height={80} />)}</div></section>
      <section className="reviews"><SectionHeading tone="violet">真实评价</SectionHeading><div className="review-grid">
        <article><p>我们团队都是用这个的，确定好选题和对标后，<strong>效率会快很多</strong>……之前我提过希望增加不同的集数选择，也是很快就上了，这点挺好的……按照官方推荐的方法来生成正文初稿，效果的确不错，这软件是目前AI里<strong>针对短剧体验最好的AI创作软件</strong>。</p><ReviewAuthor image="10" name="行业头部编剧" role="TOP3剧本工作室" /></article>
        <article><p>你们这个剧本正文的AI单集润色简直是我的福音，我现在直接拿下面编剧的稿丢进去，<strong>基本不需要我自己优化了</strong>，真心不错……不错……如果剧本改写里那个信息流，能给我直接提炼出框架就最好了！</p><ReviewAuthor image="23" name="资深短剧编剧" role="某红果爆款短剧主编" /></article>
        <article><p>这个用起来<strong>很细致</strong>，比我之前用的那些工具都要好，我把自己写的小说喂进去，就能拆出章纲，然后能顺出短剧剧本……这款工具确实不错，台词方面要自己整一下，但生成的剧本<strong>基本没有任何AI味儿</strong>，已经<strong>很省事</strong>了。</p><ReviewAuthor image="06" name="网文作者" role="某七猫签约作家" /></article>
      </div><p className="source-caption">以上为原站公开展示的评价内容</p></section>
      <div className="closing"><span>让好故事，从这里发生</span><Link className="pill light" href="/workspace">开始创作 <ArrowRight size={16} /></Link></div>
    </main>
    <footer className="site-footer"><Logo /><div className="footer-bottom"><p>StoryPlay 界面复刻 · 本地前端预览</p><span>参考来源 <a href="https://storyplay.cn" target="_blank" rel="noreferrer">storyplay.cn ↗</a></span><a href="#top" onClick={event => { event.preventDefault(); window.scrollTo({top:0,behavior:"smooth"}); }}>回到顶部 <ArrowDown size={13} className="rotate-arrow" /></a></div></footer>
  </div>;
}
function ReviewAuthor({ image, name, role }: { image: string; name: string; role: string }) {
  return <div className="review-author"><Image src={asset(`avatar-${image}.webp`)} alt="" width={64} height={64} /><div><h3>{name}</h3><span>{role}</span></div><span className="quote-mark" aria-hidden="true">”</span></div>;
}
