"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Download,
  FileText,
  FolderOpen,
  Globe2,
  Library,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";
import {
  backendRequest,
  downloadText,
  jsonBody,
  localExport,
  unitLabel,
  workPayload,
  type Action,
  type Candidate,
  type Reference,
  type StudioStatus,
  type Work,
  type World,
} from "@/lib/studio/api";
import { generateWorkCandidate } from "@/lib/studio/generation";
import { legacyWorks } from "@/lib/studio/legacy";
import { Header, Modal } from "@/components/sites/storyplay/shared";
import { WorkForm } from "./work-form";
import { ModelSettings } from "./model-settings";

const modes: Record<string, string> = {
  new: "新建剧本",
  novel: "小说创作",
  adapt: "小说改编",
  rewrite: "剧本改写",
  inspiration: "灵感策划",
};
const actions: Action[] = ["premise", "characters", "outline", "chapter"];
function actionLabel(action: Action, novel: boolean) {
  return {
    premise: "故事设定",
    characters: "人物小传",
    outline: novel ? "章节大纲" : "分集大纲",
    chapter: novel ? "小说正文" : "剧本正文",
  }[action];
}

export function StudioWorkspace() {
  const params = useSearchParams();
  return (
    <WorkspaceSession
      key={params.toString()}
      modeKey={params.get("create") || ""}
      referenceId={params.get("reference") || ""}
    />
  );
}
function WorkspaceSession({
  modeKey,
  referenceId,
}: {
  modeKey: string;
  referenceId: string;
}) {
  const [works, setWorks] = useState<Work[]>([]);
  const [worlds, setWorlds] = useState<World[]>([]);
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [reference, setReference] = useState<Reference>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<string | null>(modes[modeKey] || null);
  const [work, setWork] = useState<Work | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Action>("premise");
  const [number, setNumber] = useState(1);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [refreshCandidates, setRefreshCandidates] = useState(0);
  const [candidateError, setCandidateError] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError("");
      try {
        const [state, worldList, workList] = await Promise.all([
          backendRequest<StudioStatus>("/studio/status", { signal }),
          backendRequest<{ items: World[] }>("/studio/worlds", { signal }),
          backendRequest<{ items: Work[] }>("/studio/works", { signal }),
        ]);
        if (signal?.aborted) return;
        setStatus(state);
        setWorlds(worldList.items);
        setWorks(workList.items);
        if (referenceId)
          setReference(
            await backendRequest<Reference>(
              `/studio/references/${encodeURIComponent(referenceId)}`,
              { signal },
            ),
          );
      } catch (cause) {
        if (!signal?.aborted)
          setError(cause instanceof Error ? cause.message : "数据加载失败");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [referenceId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const workId = work?.id;
  useEffect(() => {
    if (!workId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await backendRequest<{ items: Candidate[] }>(
          `/studio/works/${workId}/candidates`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setCandidates(response.items);
        setCandidateError("");
        if (response.items.some((item) => item.status === "running"))
          timer = setTimeout(poll, 2000);
      } catch (cause) {
        if (!controller.signal.aborted)
          setCandidateError(
            cause instanceof Error ? cause.message : "候选读取失败",
          );
      }
    }
    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [workId, refreshCandidates]);
  function ensureSaved() {
    if (busy) return false;
    if (dirty) {
      setNotice("当前有未保存的修改，请先保存或导出。");
      return false;
    }
    return true;
  }
  function guard(event: MouseEvent<HTMLDivElement>) {
    if (
      (dirty || busy) &&
      event.target instanceof Element &&
      event.target.closest("a")
    ) {
      event.preventDefault();
      setNotice("当前有未保存的修改，请先保存或导出。");
    }
  }
  function startCreate(next: string) {
    if (!ensureSaved()) return;
    setMode(next);
    setNotice("");
  }
  async function openWork(ident: string, reload = false) {
    if (busy) return;
    if (reload) {
      if (
        dirty &&
        !window.confirm(
          "重新加载会放弃未保存的修改。请先导出备份；确定重新加载吗？",
        )
      )
        return;
    } else if (!ensureSaved()) return;
    setBusy(true);
    try {
      const value = await backendRequest<Work>(`/studio/works/${ident}`);
      setWork(value);
      setCandidates([]);
      setDirty(false);
      setTab("premise");
      setNumber(1);
      setRefreshCandidates((value) => value + 1);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "读取作品失败");
    } finally {
      setBusy(false);
    }
  }
  function update(patch: Partial<Work>) {
    if (work) {
      setWork({ ...work, ...patch });
      setDirty(true);
    }
  }
  async function save() {
    if (!work) return;
    setBusy(true);
    try {
      const value = await backendRequest<Work>(`/studio/works/${work.id}`, {
        method: "PUT",
        body: jsonBody({ ...workPayload(work), revision: work.revision }),
      });
      setWork(value);
      setWorks((items) => [
        value,
        ...items.filter((item) => item.id !== value.id),
      ]);
      setDirty(false);
      setNotice("已保存到本机后端。");
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "保存失败，当前编辑内容仍保留，可导出备份。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function generate(source = work, action = tab, targetNumber = number) {
    if (!source || busy || (pending && source.id === work?.id)) return;
    setBusy(true);
    setNotice("正在提交 AI 生成，请稍候…");
    try {
      await generateWorkCandidate(source, {
        action,
        number: targetNumber,
        dirty: source.id === work?.id && dirty,
        onSaved: (saved) => {
          setWork(saved);
          setWorks((items) => [
            saved,
            ...items.filter((item) => item.id !== saved.id),
          ]);
          setDirty(false);
        },
      });
      setRefreshCandidates((value) => value + 1);
      setNotice(
        "AI 已开始生成，结果将在下方显示。确认采纳后，可继续下一步创作。",
      );
      document
        .getElementById("studio-candidates")
        ?.scrollIntoView({ block: "start" });
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "生成请求失败，请刷新候选列表核对状态；作品仍保留。",
      );
      setRefreshCandidates((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  async function adopt(candidate: Candidate) {
    if (!work || !ensureSaved()) return;
    setBusy(true);
    try {
      const value = await backendRequest<Work>(
        `/studio/works/${work.id}/candidates/${candidate.id}/adopt`,
        { method: "POST", body: "{}" },
      );
      setWork(value);
      setWorks((items) => [
        value,
        ...items.filter((item) => item.id !== value.id),
      ]);
      setTab(candidate.action);
      setNumber(candidate.number);
      setDirty(false);
      setRefreshCandidates((value) => value + 1);
      setNotice("候选已采纳，作品已保存。世界原稿不会被改写。");
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "采纳失败，候选文本仍保留。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function importLegacy() {
    if (!ensureSaved()) return;
    setBusy(true);
    try {
      const drafts = legacyWorks(
        localStorage.getItem("storyplay-local-projects-v1"),
      );
      if (!drafts.length) {
        setNotice("当前浏览器没有旧版草稿。");
        return;
      }
      for (const value of drafts)
        await backendRequest("/studio/works", {
          method: "POST",
          body: jsonBody(value),
        });
      await load();
      setNotice(
        `已导入 ${drafts.length} 份旧草稿；重复导入不会覆盖作品，浏览器原记录未删除。`,
      );
    } catch (cause) {
      await load();
      setNotice(
        cause instanceof Error
          ? cause.message
          : "旧稿导入未完成，原数据未删除，可稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  const novel = work?.content_type === "novel";
  const unit = unitLabel(work?.content_type || "short_drama");
  const shown = works.filter(
    (item) =>
      (!filter || item.content_type === filter) &&
      item.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const currentText = work
    ? tab === "chapter"
      ? work.chapters.find((item) => item.number === number)?.content || ""
      : work[tab]
    : "";
  const pending = candidates.some((item) => item.status === "running");
  function changeText(text: string) {
    if (!work) return;
    if (tab === "chapter") {
      const old = work.chapters.find((chapter) => chapter.number === number);
      update({
        chapters: [
          ...work.chapters.filter((chapter) => chapter.number !== number),
          { number, title: old?.title || `第${number}${unit}`, content: text },
        ].sort((a, b) => a.number - b.number),
      });
    } else update({ [tab]: text });
  }
  return (
    <div className="workspace-page" onClickCapture={guard}>
      <Header workspace />
      <div className="studio-layout">
        <aside className="studio-sidebar">
          <div className="sidebar-label">中文创作空间</div>
          <button
            className={`sidebar-link ${!work ? "selected" : ""}`}
            onClick={() => {
              if (ensureSaved()) setWork(null);
            }}
          >
            <FolderOpen size={18} /> 我的作品
          </button>
          <button
            className="sidebar-link"
            onClick={() => startCreate("新建剧本")}
          >
            <SquarePen size={18} /> 剧本创作
          </button>
          <button
            className="sidebar-link"
            onClick={() => startCreate("小说创作")}
          >
            <BookOpen size={18} /> 小说创作
          </button>
          <Link href="/worlds" className="sidebar-link">
            <Globe2 size={18} /> 世界设定
          </Link>
          <Link href="/corpus" className="sidebar-link">
            <Library size={18} /> 语料参考
          </Link>
          <div className="sidebar-divider" />
          <button className="sidebar-link" onClick={() => setSettings(true)}>
            <Settings2 size={18} /> 模型设置
          </button>
          <button
            className="sidebar-link"
            disabled={busy}
            onClick={importLegacy}
          >
            <Download size={18} /> 导入旧草稿
          </button>
          <div className="sidebar-foot">
            <span className="local-dot" /> 本机后端保存
            <p>
              {status?.llm_ready ? "模型已配置" : "模型未配置 · 可手动创作"}
            </p>
          </div>
        </aside>
        <main className="studio-main">
          <div className="studio-connection">
            <span>
              {loading
                ? "正在连接本地后端…"
                : error
                  ? "本地后端未就绪"
                  : "中文版 · 中国语料 · 本机保存"}
            </span>
            <button onClick={() => void load()} disabled={loading}>
              刷新连接
            </button>
          </div>
          {error && (
            <div className="storage-warning" role="alert">
              {error}
            </div>
          )}
          {!work ? (
            <>
              <div className="workspace-title">
                <div>
                  <span className="eyebrow">CREATIVE WORKSPACE</span>
                  <h1>
                    我的作品<span>剧本与小说，使用同一个创作入口</span>
                  </h1>
                </div>
                <button
                  className="pill light"
                  disabled={loading || !!error || busy}
                  onClick={() => startCreate("新建剧本")}
                >
                  <Plus size={16} /> 新建作品
                </button>
              </div>
              <div className="creation-grid">
                {[
                  {
                    label: "新建剧本",
                    description: "语料参考、分集大纲与逐集正文",
                    Icon: SquarePen,
                  },
                  {
                    label: "小说创作",
                    description: "世界设定、章节大纲与逐章创作",
                    Icon: BookOpen,
                  },
                  {
                    label: "小说改编",
                    description: "导入小说素材，规划新的剧本",
                    Icon: FileText,
                  },
                ].map(({ label, description, Icon }) => (
                  <button
                    key={label}
                    className="creation-card"
                    disabled={loading || !!error || busy}
                    onClick={() => startCreate(label)}
                  >
                    <span className="feature-icon cyan">
                      <Icon size={22} />
                    </span>
                    <h2>{label}</h2>
                    <p>{description}</p>
                    <ArrowRight size={17} />
                  </button>
                ))}
              </div>
              <div className="works-toolbar">
                <div className="works-filters">
                  {[
                    { value: "", label: "全部作品" },
                    { value: "short_drama", label: "剧本" },
                    { value: "novel", label: "小说" },
                  ].map((item) => (
                    <button
                      key={item.value}
                      aria-pressed={filter === item.value}
                      className={filter === item.value ? "active" : ""}
                      onClick={() => setFilter(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <label className="search-field">
                  <Search size={15} />
                  <input
                    aria-label="搜索作品"
                    placeholder="搜索作品名称"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
              {loading ? (
                <div className="empty-workspace">正在读取作品…</div>
              ) : shown.length ? (
                <div className="project-grid">
                  {shown.map((item) => (
                    <button
                      className="project-card"
                      key={item.id}
                      disabled={busy}
                      onClick={() => void openWork(item.id)}
                    >
                      <div className="project-cover">
                        <FileText size={35} />
                        <span>
                          {item.content_type === "novel" ? "小说" : "剧本"} ·{" "}
                          {item.genre}
                        </span>
                      </div>
                      <div className="project-info">
                        <h3>{item.title}</h3>
                        <p>
                          {
                            item.chapters.filter((chapter) => chapter.content)
                              .length
                          }{" "}
                          / {item.units}
                          {unitLabel(item.content_type)} · v{item.revision}
                        </p>
                        <time>
                          {new Date(item.updated_at).toLocaleDateString(
                            "zh-CN",
                          )}{" "}
                          更新
                        </time>
                      </div>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-workspace">
                  <FolderOpen size={35} strokeWidth={1} />
                  <h2>
                    {error
                      ? "请先连接本地后端"
                      : works.length
                        ? "没有找到相应作品"
                        : "从第一个故事开始"}
                  </h2>
                  <p>
                    {error
                      ? "后端启动后点击刷新连接。"
                      : "创建剧本或小说，之后可绑定世界、生成候选、编辑并导出。"}
                  </p>
                </div>
              )}
              <p className="workspace-disclaimer">
                世界设定与创作候选参考 StoryForge
                的分层方式；当前为中文基础整合版。
              </p>
            </>
          ) : (
            <>
              <div className="editor-top">
                <button
                  className="icon-button"
                  aria-label="返回作品列表"
                  onClick={() => {
                    if (ensureSaved()) setWork(null);
                  }}
                >
                  <ArrowLeft size={20} />
                </button>
                <div>
                  <input
                    className="project-title-input"
                    aria-label="作品名称"
                    maxLength={80}
                    disabled={busy}
                    value={work.title}
                    onChange={(event) => update({ title: event.target.value })}
                  />
                  <p>
                    {novel ? "小说" : "剧本"} / {work.genre} / {work.units}
                    {unit} / v{work.revision}
                  </p>
                </div>
                <div className="editor-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void openWork(work.id, true)}
                  >
                    重新加载
                  </button>
                  <span className="save-state">
                    {dirty ? "未保存修改" : "已保存本机"}
                  </span>
                  <button
                    className="outline-button"
                    onClick={() =>
                      downloadText(`${work.title}.txt`, localExport(work))
                    }
                  >
                    <Download size={15} /> 导出
                  </button>
                  <button
                    className="pill light"
                    disabled={busy}
                    onClick={() => void save()}
                  >
                    <Save size={15} /> 保存
                  </button>
                </div>
              </div>
              <div className="studio-work-context">
                <label>
                  世界设定
                  <select
                    disabled={busy}
                    value={work.world_id || ""}
                    onChange={(event) =>
                      update({ world_id: event.target.value || null })
                    }
                  >
                    <option value="">暂不绑定世界</option>
                    {worlds.map((world) => (
                      <option value={world.id} key={world.id}>
                        {world.name} · v{world.revision}
                      </option>
                    ))}
                  </select>
                </label>
                <span>
                  {work.world_id
                    ? "生成时冻结世界版本；修改世界不会自动覆盖正文。"
                    : "可以先自由创作，随时绑定一个世界。"}
                </span>
                <Link href="/worlds">
                  管理世界 <ArrowRight size={12} />
                </Link>
              </div>
              <div className="editor-tabs" role="tablist" aria-label="创作步骤">
                {actions.map((action, index) => (
                  <button
                    role="tab"
                    id={`studio-tab-${index}`}
                    aria-selected={tab === action}
                    aria-controls="studio-editor"
                    key={action}
                    className={tab === action ? "active" : ""}
                    onClick={() => setTab(action)}
                  >
                    <span>0{index + 1}</span>
                    {actionLabel(action, novel)}
                  </button>
                ))}
              </div>
              <section
                className="editor-panel"
                id="studio-editor"
                role="tabpanel"
                aria-labelledby={`studio-tab-${actions.indexOf(tab)}`}
              >
                <div className="editor-panel-heading">
                  <div>
                    <h2>{actionLabel(tab, novel)}</h2>
                    <p>
                      点击 AI 生成，下方查看结果并确认采纳；有修改时会先保存。
                    </p>
                  </div>
                  <div className="studio-generate-controls">
                    {tab === "chapter" && (
                      <select
                        aria-label={`选择${unit}`}
                        value={number}
                        onChange={(event) =>
                          setNumber(Number(event.target.value))
                        }
                      >
                        {Array.from({ length: work.units }, (_, index) => (
                          <option value={index + 1} key={index}>
                            第{index + 1}
                            {unit}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      className="pill light"
                      disabled={busy || pending}
                      onClick={() => void generate()}
                    >
                      <Sparkles size={14} />
                      {pending
                        ? "AI 生成中…"
                        : busy
                          ? "正在提交…"
                          : `${dirty ? "保存并 " : ""}AI 生成${actionLabel(tab, novel)}`}
                    </button>
                  </div>
                </div>
                <textarea
                  disabled={busy}
                  className="script-editor"
                  aria-label={actionLabel(tab, novel)}
                  value={currentText}
                  onChange={(event) => changeText(event.target.value)}
                  placeholder={
                    tab === "premise"
                      ? "写下人物、冲突与故事方向，再保存。"
                      : tab === "chapter"
                        ? `在这里编写第${number}${unit}正文…`
                        : "在这里整理并保存内容…"
                  }
                />
                <div className="editor-bottom">
                  <span>{currentText.replace(/\s/g, "").length} 字</span>
                  <span>生成候选不会直接改写原文</span>
                </div>
              </section>
              <section
                id="studio-candidates"
                className="studio-candidates"
                aria-label="创作候选"
              >
                <div className="studio-section-bar">
                  <h2>创作候选</h2>
                  <button
                    onClick={() => setRefreshCandidates((value) => value + 1)}
                  >
                    刷新候选
                  </button>
                </div>
                {candidateError && (
                  <p className="studio-error" role="alert">
                    {candidateError}
                  </p>
                )}
                {!status?.llm_ready && (
                  <p className="studio-hint">
                    尚未配置模型。可先手动编辑，或打开模型设置后生成。
                  </p>
                )}
                {!candidates.length && (
                  <div className="studio-candidate">
                    <p className="studio-hint">
                      {pending
                        ? "AI 正在创作，请稍候…"
                        : "保存草稿不会自动生成。点击下面的按钮开始 AI 创作，结果会出现在这里。"}
                    </p>
                    <div className="studio-candidate-actions">
                      <button
                        className="pill light"
                        disabled={busy || pending}
                        onClick={() => void generate()}
                      >
                        <Sparkles size={14} />{" "}
                        {busy
                          ? "正在提交…"
                          : `AI 生成${actionLabel(tab, novel)}`}
                      </button>
                    </div>
                  </div>
                )}
                {candidates.map((candidate) => (
                  <article className="studio-candidate" key={candidate.id}>
                    <div className="studio-section-bar">
                      <h3>
                        {actionLabel(candidate.action, novel)}
                        {candidate.action === "chapter"
                          ? ` · 第${candidate.number}${unit}`
                          : ""}
                      </h3>
                      <span>
                        {candidate.status === "running"
                          ? "正在生成"
                          : candidate.status === "proposed"
                            ? "待确认采纳"
                            : candidate.status === "adopted"
                              ? "已采纳"
                              : "生成失败"}
                        {candidate.world_revision
                          ? ` · 世界 v${candidate.world_revision}`
                          : ""}
                      </span>
                    </div>
                    {candidate.status === "running" ? (
                      <p className="studio-hint">
                        可离开后重新打开作品查看结果，请勿重复提交。
                      </p>
                    ) : candidate.error ? (
                      <p className="studio-error">{candidate.error}</p>
                    ) : (
                      <pre>{candidate.text}</pre>
                    )}
                    {candidate.references.length > 0 && (
                      <details>
                        <summary>
                          本次参考语料（{candidate.references.length}）
                        </summary>
                        <ul>
                          {candidate.references.map((item) => (
                            <li key={item.id}>
                              {item.title} · {item.source || "本机语料库"}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <div className="studio-candidate-actions">
                      {candidate.text && (
                        <button
                          className="outline-button"
                          onClick={() =>
                            downloadText(
                              `${work.title}-候选.txt`,
                              candidate.text,
                            )
                          }
                        >
                          导出候选
                        </button>
                      )}
                      {candidate.status === "proposed" && (
                        <button
                          className="pill light"
                          disabled={busy || dirty}
                          onClick={() => void adopt(candidate)}
                        >
                          确认采纳
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </section>
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="notice" role="status">
          <Check size={15} />
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {mode && !loading && !error && (
        <Modal title={mode} wide onClose={() => setMode(null)}>
          <WorkForm
            key={`${mode}:${reference?.id || ""}`}
            mode={mode}
            worlds={worlds}
            reference={reference}
            onCreated={(value, autoGenerate) => {
              setWorks((items) => [value, ...items]);
              setWork(value);
              setDirty(false);
              setTab("premise");
              setMode(null);
              setNumber(1);
              setCandidates([]);
              setRefreshCandidates((value) => value + 1);
              setNotice(
                autoGenerate
                  ? "作品已创建，正在启动 AI 生成…"
                  : "草稿已保存。点击 AI 生成按钮即可开始创作。",
              );
              if (autoGenerate) void generate(value, "premise", 1);
            }}
            onClose={() => setMode(null)}
          />
        </Modal>
      )}
      {settings && (
        <ModelSettings
          onClose={() => setSettings(false)}
          onSaved={() => {
            void load();
            setNotice("模型配置已保存到本机后端。");
          }}
        />
      )}
    </div>
  );
}
