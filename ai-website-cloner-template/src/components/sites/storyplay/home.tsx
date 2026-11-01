"use client";
import { RegionalGallery } from "./regional-gallery";
import { usePreferences } from "@/lib/i18n/provider";
import { useUI } from "@/lib/i18n/provider";


import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Globe2,
  SquarePen,
} from "lucide-react";
import { storyConcepts } from "./story-concepts";
import { ConceptPoster } from "./concept-poster";
import { Header, SectionHeading } from "./shared";

export function StoryplayHome() {
  const ui = useUI();
  const { market } = usePreferences();
  const regional = market === "china" || market === "arab";
  const gallery = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const element = gallery.current;
    if (
      !element ||
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    element.dataset.motion = "enabled";
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          element.classList.add("is-revealed");
          observer.disconnect();
        }
      },
      { threshold: 0.08 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="storyplay-home">
      <Header />
      <main>
        <section className="hero">
          <h2>{ui("短剧与小说创作平台")}</h2>
          <h1>{ui("让AI辅助故事创作者成为超级个体")}</h1>
          <p>{ui("从故事设定到正文，让灵感逐步成稿")}</p>
          <Link href="/workspace" className="pill light hero-cta">
            {ui(" 立即体验 ")}</Link>
          <div className="hero-tools" aria-label={ui("主要创作功能")}>
            <Link href="/studio/scripts/new">
              <SquarePen size={15} /> {ui(" 新建剧本 ")}</Link>
            <span />
            <Link href="/studio/novels/new">
              <BookOpen size={15} /> {ui(" 小说创作 ")}</Link>
            <span />
            <Link href="/worlds">
              <Globe2 size={15} /> {ui(" 世界设定 ")}</Link>
          </div>
        </section>
        <section className="lapian-section" aria-labelledby="lapian-heading">
          <header className="lapian-intro">
            <SectionHeading>{ui("故事灵感")}</SectionHeading>
            <p id="lapian-heading">
              {ui(" 从星空铁路到雨夜街角，让每一个世界都有自己的故事。 ")}<br className="desktop-break" />
              {ui(" 探索 Plotloom 的原创动漫视觉概念，开启下一段创作。 ")}</p>
            <Link className="gold-button" href="/corpus">
              {ui(" 查看语料参考 ")}</Link>
          </header>
          {regional ? <RegionalGallery market={market} /> : <div ref={gallery} className="poster-stage">
            <div className="poster-grid" key={page}>
              {[
                ...storyConcepts.slice(page * 5),
                ...storyConcepts.slice(0, page * 5),
              ].map((concept, index) => (
                <ConceptPoster
                  key={concept.slug}
                  concept={concept}
                  index={index}
                />
              ))}
            </div>
          </div>}
          {!regional && <div className="gallery-paging">
            <button
              className="paging-arrow"
              disabled={page === 0}
              onClick={() => setPage(0)}
              aria-label={ui("上一组海报")}
            >
              <ChevronLeft size={20} />
            </button>
            {[0, 1].map((index) => (
              <button
                aria-label={ui(`第${index + 1}组海报`)}
                aria-pressed={page === index}
                key={index}
                className={`paging-dot ${page === index ? "active" : ""}`}
                onClick={() => setPage(index)}
              />
            ))}
            <button
              className="paging-arrow"
              disabled={page === 1}
              onClick={() => setPage(1)}
              aria-label={ui("下一组海报")}
            >
              <ChevronRight size={20} />
            </button>
          </div>}
          <p className="concept-disclaimer">
            {ui(" 原创 AI 视觉概念 · 虚构故事企划，非已上线影视作品 ")}</p>
        </section>
      </main>
    </div>
  );
}
