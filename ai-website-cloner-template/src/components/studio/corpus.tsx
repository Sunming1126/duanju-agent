"use client";
import { usePreferences } from "@/lib/i18n/provider";
import { useUI } from "@/lib/i18n/provider";


import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, Search } from "lucide-react";
import {
  backendRequest,
  type ContentType,
  type Reference,
} from "@/lib/studio/api";
import { StudioNav } from "./navigation";
import { Header } from "@/components/sites/storyplay/shared";

function sourceUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function CorpusWorkspace() {
  const ui = useUI();
  const preferences = usePreferences();
  const [items, setItems] = useState<Reference[]>([]);
  const [type, setType] = useState<ContentType>("short_drama");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError("");
      setLoading(true);
      try {
        const result = await backendRequest<{ items: Reference[] }>(
          `/studio/references?content_type=${type}&query=${encodeURIComponent(search)}&limit=30&market=${preferences.market}&output_locale=${preferences.locale}`,
          { signal },
        );
        if (!signal?.aborted) setItems(result.items);
      } catch (cause) {
        if (!signal?.aborted)
          setError(cause instanceof Error ? cause.message : "语料读取失败");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [type, search, preferences.market, preferences.locale],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  function submit(event: FormEvent) {
    event.preventDefault();
    setSearch(query.trim());
  }
  return (
    <div className="workspace-page">
      <Header workspace />
      <div className="plotloom-shell">
        <StudioNav selected="语料参考" />
        <main className="plotloom-main" aria-label={ui("语料参考")}>
          <div className="works-filters"><button className={type === "short_drama" ? "active" : ""} onClick={() => setType("short_drama")}>{ui("中文剧本")}</button><button className={type === "novel" ? "active" : ""} onClick={() => setType("novel")}>{ui("中文小说")}</button></div>
          <form className="studio-corpus-search" onSubmit={submit}>
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label={ui("搜索语料")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={ui("题材、故事冲突或关键词")}
                maxLength={500}
              />
            </label>
            <button type="submit" className="pill light">
              {ui(" 搜索 ")}</button>
            <button
              type="button"
              className="text-button"
              onClick={() => void load()}
            >
              {ui(" 刷新 ")}</button>
          </form>
          {error && (
            <p className="storage-warning" role="alert">
              {ui(error, true)}
            </p>
          )}
          {loading ? (
            <div className="empty-workspace">{ui("正在读取语料…")}</div>
          ) : !items.length ? (
            <div className="empty-workspace">
              <BookOpen size={32} />
              <h2>{ui("没有找到对应语料")}</h2>
              <p>
                {ui(" 可换一个关键词，或在原平台手动导入中文语料。本页不会自动采集。 ")}</p>
            </div>
          ) : (
            <div className="studio-reference-grid">
              {items.map((item) => (
                <article className="studio-reference" key={item.id}>
                  <span>
                    {ui(item.content_type === "novel" ? "小说" : "剧本")} {ui(" ·")}{ui(" ")}
                    {ui(item.genre)}
                  </span>
                  <h2>{item.title}</h2>
                  <p>{ui(item.logline || item.hook || "该条目尚无故事梗概。")}</p>
                  {item.hook && item.hook !== item.logline && (
                    <p className="studio-hint">{ui("开场参考：")}{ui(item.hook)}</p>
                  )}
                  <div className="studio-reference-source">
                    {ui(item.source)}
                    {sourceUrl(item.source_url) && (
                      <a
                        href={sourceUrl(item.source_url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {ui(" 查看来源 ↗ ")}</a>
                    )}
                  </div>
                  <details><summary>{ui("预览资料")}</summary><p className="studio-hint">{ui(item.beats.length ? item.beats.join("\n") : "此条目暂无更多情节拆解，详见来源。")}</p></details>
                  <Link
                    className="outline-button"
                    href={`/workspace?create=${type === "novel" ? "novel" : "new"}&reference=${encodeURIComponent(item.id)}`}
                  >
                    {ui(" 以此创建")}{ui(type === "novel" ? "小说" : "剧本")}{ui("草稿")}{ui(" ")}
                    <ArrowRight size={13} />
                  </Link>
                </article>
              ))}
            </div>
          )}
          <p className="workspace-disclaimer">
            {ui(" 资料卡与故事摘要是参考，不是完整剧本。作品生成会标记实际引用的素材。 ")}</p>
        </main>
      </div>
    </div>
  );
}
