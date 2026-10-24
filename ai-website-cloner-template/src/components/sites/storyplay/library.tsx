"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { storyConcepts, conceptImage } from "./story-concepts";
import { Header, Modal } from "./shared";

export function DramaLibrary() {
  const params = useSearchParams();
  const [selected, setSelected] = useState<string | null>(() =>
    storyConcepts.some((item) => item.slug === params.get("concept"))
      ? params.get("concept")
      : null,
  );
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("全部");
  const shown = useMemo(
    () =>
      storyConcepts.filter(
        (item) =>
          `${item.title} ${item.japaneseTitle}`.includes(query.trim()) &&
          (genre === "全部" || item.genre === genre),
      ),
    [query, genre],
  );
  const current = storyConcepts.find((item) => item.slug === selected);
  return (
    <div className="library-page">
      <Header workspace />
      <main className="library-main">
        <Link className="back-link" href="/">
          <ArrowLeft size={15} /> 返回首页
        </Link>
        <div className="library-title">
          <div>
            <span className="eyebrow gold">PLOTLOOM ORIGINAL CONCEPTS</span>
            <h1>故事灵感</h1>
            <p>从一幅画面，展开一个属于你的世界。</p>
          </div>
          <Link href="/studio/novels/new" className="pill light">
            开始创作 <ArrowRight size={16} />
          </Link>
        </div>
        {params.has("detail") && (
          <p className="storage-warning">
            旧版参考海报已移除。你可以浏览下方新创作的故事概念。
          </p>
        )}
        <div className="library-filters">
          <div className="genre-row">
            <span>
              <SlidersHorizontal size={15} /> 题材
            </span>
            {["全部", ...new Set(storyConcepts.map((item) => item.genre))].map(
              (item) => (
                <button
                  key={item}
                  className={genre === item ? "active" : ""}
                  onClick={() => setGenre(item)}
                >
                  {item}
                </button>
              ),
            )}
          </div>
          <div className="library-toolbar">
            <span>原创动漫视觉概念</span>
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="搜索故事概念"
                placeholder="搜索中文或日文标题"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="library-results">
          <span>共 {shown.length} 个概念</span>
          <span>Plotloom 原创企划 · AI 绘制</span>
        </div>
        {shown.length ? (
          <div className="library-grid">
            {shown.map((item) => (
              <button
                key={item.slug}
                className="library-card"
                onClick={() => setSelected(item.slug)}
              >
                <div className="library-poster">
                  <Image
                    src={conceptImage(item.slug)}
                    alt={item.alt}
                    width={1024}
                    height={1536}
                    sizes="(max-width: 640px) 44vw, 240px"
                  />
                  <span className="poster-overlay">
                    <span>
                      探索故事 <ChevronRight size={16} />
                    </span>
                  </span>
                </div>
                <h2>{item.title}</h2>
                <p>
                  {item.genre}
                  <span>
                    查看概念 <ArrowRight size={12} />
                  </span>
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-workspace">
            <Search size={34} />
            <h2>没有找到相关概念</h2>
            <button
              className="outline-button"
              onClick={() => {
                setQuery("");
                setGenre("全部");
              }}
            >
              清除筛选
            </button>
          </div>
        )}
        <p className="workspace-disclaimer">
          以上为本项目生成的原创视觉概念与虚构故事简介，不代表已上线作品、市场排名或真实语料。
        </p>
      </main>
      {current && (
        <Modal title="原创故事概念" wide onClose={() => setSelected(null)}>
          <div className="drama-detail">
            <Image
              src={conceptImage(current.slug)}
              alt={current.alt}
              width={1024}
              height={1536}
              sizes="280px"
            />
            <div>
              <span className="detail-tag">{current.genre} · AI 视觉概念</span>
              <h2>{current.title}</h2>
              <p lang="ja">{current.japaneseTitle}</p>
              <div className="detail-description">
                <h3>故事起点</h3>
                <p>{current.description}</p>
              </div>
              <Link className="pill light" href="/studio/novels/new">
                创建自己的故事 <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
