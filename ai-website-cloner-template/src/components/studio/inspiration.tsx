"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, PencilLine, Sparkles } from "lucide-react";
import { Modal } from "@/components/sites/storyplay/shared";
import { backendRequest as api, jsonBody, scopedDraftKey, readScopedDraft, type ContentType, type WorkInput } from "@/lib/studio/api";
import { showInspirationAnalysis, showPreviousInspirationAnalysis, type InspirationPlan, type InspirationSession } from "@/lib/studio/inspiration";

const pending = (session?: InspirationSession) => !!session && ["queued", "running"].includes(session.job.status);

export function Inspiration({ type, initialPrompt, onApply, onClose }: {
  type: ContentType; initialPrompt: string; onApply: (analysis: WorkInput) => void; onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [audience, setAudience] = useState("general");
  const [genres, setGenres] = useState("");
  const [core, setCore] = useState("");
  const [styles, setStyles] = useState("");
  const [session, setSession] = useState<InspirationSession>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(true);
  const [review, setReview] = useState(false);
  const [startOver, setStartOver] = useState(false);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const [submittingAnalysis, setSubmittingAnalysis] = useState(false);
  const [viewPrevious, setViewPrevious] = useState(false);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const lock = useRef(false);
  const flowRef = useRef<HTMLDivElement>(null);
  const analysisRef = useRef<HTMLElement>(null);
  const baseStorageKey = `plotloom-inspiration-${type}`;
  const storageKey = scopedDraftKey(baseStorageKey);
  const inputKey = `${storageKey}-input`;
  const label = type === "novel" ? "小说" : "剧本";

  const remember = useCallback((value: InspirationSession) => {
    setSession(value);
    try { localStorage.setItem(storageKey, value.id); } catch { /* The server still retains the session. */ }
  }, [storageKey]);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const raw = localStorage.getItem(inputKey) ?? readScopedDraft(`${baseStorageKey}-input`);
        if (raw) {
          const saved = JSON.parse(raw);
          if (typeof saved.prompt === "string") setPrompt(saved.prompt);
          if (typeof saved.audience === "string") setAudience(saved.audience);
          if (typeof saved.genres === "string") setGenres(saved.genres);
          if (typeof saved.core === "string") setCore(saved.core);
          if (typeof saved.styles === "string") setStyles(saved.styles);
          if (saved.request?.key && typeof saved.request.signature === "string") request.current = saved.request;
        }
        const ident = localStorage.getItem(storageKey) ?? readScopedDraft(baseStorageKey);
        if (ident) {
          const value = await api<InspirationSession>(`/studio/inspirations/${encodeURIComponent(ident)}`, { signal: controller.signal });
          if (!disposed && value.input.content_type === type) remember(value);
        }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : "读取上次灵感失败，输入仍可重新填写。");
      } finally { if (!disposed) setRestoring(false); }
    })();
    return () => { disposed = true; controller.abort(); };
  }, [storageKey, baseStorageKey, inputKey, type, remember]);

  useEffect(() => {
    if (restoring) return;
    try { localStorage.setItem(inputKey, jsonBody({ prompt, audience, genres, core, styles, request: request.current })); }
    catch { /* Session results remain on the server if browser storage is unavailable. */ }
  }, [prompt, audience, genres, core, styles, inputKey, restoring]);

  useEffect(() => {
    if (!session || !pending(session)) return;
    let disposed = false;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void api<InspirationSession>(`/studio/inspirations/${session.id}`, { signal: controller.signal })
        .then(value => { if (!disposed) { remember(value); setError(""); } })
        .catch(e => { if (!disposed) setError(e.message); });
    }, 2000);
    return () => { disposed = true; clearInterval(timer); controller.abort(); };
  }, [session, remember]);

  const run = async (path: string, payload?: Record<string, unknown>, method = "POST") => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setReview(false);
    try {
      let body = payload;
      if (payload && method === "POST") {
        const signature = path + jsonBody(payload);
        if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
        body = { ...payload, request_key: request.current.key };
        try { localStorage.setItem(inputKey, jsonBody({ prompt, audience, genres, core, styles, request: request.current })); } catch { /* Optional local recovery. */ }
      }
      const value = await api<InspirationSession>(path, { method, ...(method === "GET" ? {} : { body: jsonBody(body || {}) }) });
      remember(value); setStartOver(false);
      request.current = null;
      return value;
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败，方案已保留。"); }
    finally { lock.current = false; setBusy(false); }
  };
  const waiting = busy || restoring || pending(session);
  const analyzing = session?.job.action === "analyze" && pending(session);
  const previousAnalysis = showPreviousInspirationAnalysis(session, viewPrevious, submittingAnalysis);
  const showAnalysis = showInspirationAnalysis(session, dismissedJobId, submittingAnalysis) || previousAnalysis;

  const scrollToTop = () => flowRef.current?.closest("dialog")?.scrollTo({ top: 0, behavior: "auto" });

  useEffect(() => {
    if (!showAnalysis) return;
    const dialog = flowRef.current?.closest("dialog");
    const result = analysisRef.current;
    if (dialog && result) {
      dialog.scrollTo({ top: Math.max(0, dialog.scrollTop + result.getBoundingClientRect().top - dialog.getBoundingClientRect().top - 24), behavior: "auto" });
      result.focus({ preventScroll: true });
    }
  }, [showAnalysis]);

  const actOnPlan = async (plan: InspirationPlan, action: "revise" | "analyze", feedback: string) => {
    if (!session || lock.current) return;
    if (action === "analyze") {
      setSubmittingAnalysis(true);
      scrollToTop();
    }
    setViewPrevious(false);
    try {
      await run(`/studio/inspirations/${session.id}/actions`, { action, feedback, plan_id: plan.id, revision: session.revision });
    } finally {
      if (action === "analyze") setSubmittingAnalysis(false);
    }
  };

  return <Modal title={`${label}灵感创作`} wide onClose={onClose}>
    <div className="inspiration-flow" ref={flowRef}>
      <div className="inspiration-hero"><span className="inspiration-eyebrow"><Sparkles size={16} /> 从一个念头开始</span><h2>AI 灵感策划</h2><p>描述你的想法，探索三个故事方向，再把喜欢的方案变成{label}。</p></div>
      <ol className="inspiration-steps" aria-label="灵感创作步骤"><li className={!session?.plans.length || startOver ? "current" : ""}>01 描述想法</li><li className={session?.plans.length && !showAnalysis && !startOver ? "current" : ""}>02 打磨方案</li><li className={showAnalysis ? "current" : ""}>03 确认创作设定</li></ol>
      {restoring && <p role="status">正在读取灵感草稿…</p>}
      {(!session?.plans.length || startOver) && <div className="inspiration-composer create-form">
        <label className="sr-only" htmlFor="inspiration-prompt">自然语言描述故事想法</label>
        <textarea id="inspiration-prompt" value={prompt} disabled={waiting} maxLength={12000} rows={5} onChange={e => setPrompt(e.target.value)} placeholder={`比如：我想写一个${type === "novel" ? "带悬疑感的都市小说" : "关于小人物逆袭的短剧"}，主角意外收到十年后自己的来信，但每次改变未来都要失去一段记忆……`} />
        <details className="inspiration-preferences"><summary>添加偏好 · 目标受众 / 题材类型 / 核心设定 / 风格元素</summary><div className="inspiration-preference-grid">
          <label>目标受众<select value={audience} disabled={waiting} onChange={e => setAudience(e.target.value)}><option value="general">不限</option><option value="female">女性向</option><option value="male">男性向</option></select></label>
          <label>题材类型<input value={genres} maxLength={240} disabled={waiting} onChange={e => setGenres(e.target.value)} placeholder="都市，悬疑" /></label>
          <label>核心设定<input value={core} maxLength={240} disabled={waiting} onChange={e => setCore(e.target.value)} placeholder="时间循环，身份错位" /></label>
          <label>风格元素<input value={styles} maxLength={400} disabled={waiting} onChange={e => setStyles(e.target.value)} placeholder="温暖，反转，黑色幽默" /></label>
        </div></details>
        <div className="inspiration-compose-actions"><span>{prompt.length}/12,000{prompt.length > 12000 ? " · 请精简想法后生成" : ""}</span><button className="inspiration-primary" type="button" disabled={waiting || !prompt.trim() || prompt.length > 12000} onClick={() => void run("/studio/inspirations", { market: "china", output_locale: "zh-CN", content_type: type, prompt: prompt.trim(), audience, genres, core, styles })}><Sparkles size={16} />{waiting ? "正在策划…" : "生成三个参考方案"}</button></div>
      </div>}
      {session && <>
        {(pending(session) || submittingAnalysis) && <div className="inspiration-progress" role="status"><LoaderCircle size={18} className="inspiration-spinner" /><div>{submittingAnalysis && !pending(session) ? "正在提交解析任务…" : session.job.status === "queued" ? "已排队，正在等待创作服务" : analyzing ? "正在解析选定方案的题材、设定和世界观…" : session.job.action === "revise" ? "正在按你的要求打磨方案…" : "正在构思三个不同的故事方向…"}<p>可以先关闭窗口，稍后重新打开查看结果。</p></div></div>}
        {session.job.error && <div className="studio-error" role="alert"><p>{session.job.error}</p>{["failed", "interrupted"].includes(session.job.status) && <button className="outline-button" type="button" disabled={waiting} onClick={() => { setViewPrevious(false); void run(`/studio/inspiration-jobs/${session.job.id}/resume`); }}>手动重试本次任务</button>}</div>}
        {error && <p className="studio-error" role="alert">{error}</p>}
        <div className="studio-section-bar"><span className="studio-hint">灵感草稿 · v{session.revision}</span><button className="text-button" type="button" disabled={busy || restoring} onClick={() => void run(`/studio/inspirations/${session.id}`, undefined, "GET")}>刷新方案与进度</button></div>
        {!!session.plans.length && !showAnalysis && <><div className="studio-section-bar"><div><h3>选择你的故事方向</h3><p className="studio-hint">每个方案都可以独立编辑，或告诉 AI 你想怎么改。</p></div><div className="inspiration-plan-actions">{session.analysis && session.job.action === "analyze" && session.job.status === "completed" && dismissedJobId === session.job.id && <button className="text-button" type="button" disabled={waiting} onClick={() => { setStartOver(false); setDismissedJobId(null); }}>查看已解析方案</button>}{session.analysis && ["failed", "interrupted"].includes(session.job.status) && <button className="text-button" type="button" disabled={waiting} onClick={() => { setStartOver(false); setViewPrevious(true); }}>查看上次解析结果</button>}<button className="text-button" type="button" disabled={waiting} onClick={() => setStartOver(!startOver)}>{startOver ? "收起输入" : "重新描述想法"}</button></div></div>
          <div className="inspiration-plan-grid">{session.plans.map((plan, index) => <PlanCard key={`${plan.id}:${plan.title}:${plan.summary}:${plan.story}`} plan={plan} index={index} disabled={waiting} selected={session.job.action === "analyze" && session.job.status === "completed" && session.analyzed_plan_id === plan.id} onSave={async value => !!(await run(`/studio/inspirations/${session.id}/plans/${plan.id}`, { ...value, revision: session.revision }, "PUT"))} onAction={(action, feedback = "") => void actOnPlan(plan, action, feedback)} />)}</div>
        </>}
        {showAnalysis && session.analysis && <section className="inspiration-analysis" ref={analysisRef} tabIndex={-1} aria-label={previousAnalysis ? "上次解析结果" : "已解析选定方案"}><span className="inspiration-eyebrow">{previousAnalysis ? "上次解析结果 · 本次任务未成功" : "已解析选定方案"}</span><h3>{session.analysis.title}</h3><dl><div><dt>题材</dt><dd>{session.analysis.creative?.genres?.join(" · ")}</dd></div><div><dt>核心设定</dt><dd>{session.analysis.creative?.core?.join(" · ")}</dd></div><div><dt>风格</dt><dd>{session.analysis.creative?.styles?.join(" · ")}</dd></div><div><dt>核心亮点</dt><dd>{session.analysis.creative?.highlights}</dd></div><div><dt>世界观</dt><dd>{session.analysis.world_snapshot?.description}</dd></div></dl><p className="studio-hint">回填后仍可修改全部参数。确认表单前不会创建作品或生成正文。</p>
          {!review ? <button type="button" className="inspiration-primary" disabled={waiting} onClick={() => setReview(true)}>使用这个方案，查看回填确认 <ArrowRight size={16} /></button> : <div className="inspiration-confirm" role="status"><p>将替换表单中的名称、故事想法、题材、核心设定、风格、亮点、数量、受众和世界观。原表单会保留一份可恢复备份。</p><button type="button" className="inspiration-primary" disabled={waiting} onClick={() => onApply(session.analysis!)}>确认回填创作表单</button><button type="button" className="text-button" onClick={() => setReview(false)}>返回检查</button></div>}
          <button type="button" className="text-button" disabled={waiting} onClick={() => { setDismissedJobId(session.job.id); setViewPrevious(false); setReview(false); scrollToTop(); }}>返回三个方案</button>
        </section>}
      </>}
      {!session && error && <p className="studio-error" role="alert">{error}</p>}
      <p className="studio-hint">灵感草稿独立保存 · 方案由 AI 生成，请确认后使用</p>
    </div>
  </Modal>;
}

function restorePlanInput(plan: InspirationPlan) {
  const value = { title: plan.title, summary: plan.summary, story: plan.story };
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(`plotloom-plan-input-${plan.id}`) : null;
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached.baseline === jsonBody(value) && typeof cached.value?.title === "string" && typeof cached.value?.summary === "string" && typeof cached.value?.story === "string") {
        return { value: cached.value as typeof value, feedback: typeof cached.feedback === "string" ? cached.feedback : "", edit: !!cached.edit };
      }
    }
  } catch { /* The server's saved plan remains available. */ }
  return { value, feedback: "", edit: false };
}

function PlanCard({ plan, index, disabled, selected, onSave, onAction }: {
  plan: InspirationPlan; index: number; disabled: boolean; selected: boolean;
  onSave: (value: Omit<InspirationPlan, "id">) => Promise<boolean>;
  onAction: (action: "revise" | "analyze", feedback?: string) => void;
}) {
  const [restored] = useState(() => restorePlanInput(plan));
  const [edit, setEdit] = useState(restored.edit);
  const [value, setValue] = useState(restored.value);
  const [feedback, setFeedback] = useState(restored.feedback);
  const [error, setError] = useState("");
  const dirty = value.title !== plan.title || value.summary !== plan.summary || value.story !== plan.story;
  useEffect(() => {
    try {
      localStorage.setItem(`plotloom-plan-input-${plan.id}`, jsonBody({ baseline: jsonBody({ title: plan.title, summary: plan.summary, story: plan.story }), value, feedback, edit }));
    } catch { /* Saving the plan to the server is still available. */ }
  }, [plan, value, feedback, edit]);
  async function save() {
    if (!value.title.trim() || !value.summary.trim() || value.story.trim().length < 20) { setError("请填写名称、卖点和不少于20字的故事方案。"); return; }
    if (await onSave(value)) setEdit(false);
  }
  return <article className={`inspiration-plan ${selected ? "selected" : ""}`}><span className="inspiration-plan-number">方向 0{index + 1}{selected ? " · 已选定" : ""}</span>
    {edit ? <div className="create-form"><label>方案名称<input maxLength={80} value={value.title} disabled={disabled} onChange={e => setValue({ ...value, title: e.target.value })} /></label><label>一句话卖点<input maxLength={500} value={value.summary} disabled={disabled} onChange={e => setValue({ ...value, summary: e.target.value })} /></label><label>故事方案<textarea rows={12} maxLength={12000} value={value.story} disabled={disabled} onChange={e => setValue({ ...value, story: e.target.value })} /></label><button type="button" className="outline-button" disabled={disabled} onClick={() => void save()}>保存方案修改</button><button type="button" className="text-button" disabled={disabled} onClick={() => { setValue({ title: plan.title, summary: plan.summary, story: plan.story }); setEdit(false); setError(""); }}>取消编辑</button></div>
      : <><h3>{plan.title}</h3><p className="inspiration-plan-summary">{plan.summary}</p><div className="inspiration-plan-story">{plan.story}</div><button type="button" className="text-button" disabled={disabled} onClick={() => setEdit(true)}><PencilLine size={14} /> 编辑此方案</button></>}
    <div className="inspiration-plan-bottom"><label>告诉 AI 你想怎么改<textarea rows={2} maxLength={4000} value={feedback} disabled={disabled} onChange={e => setFeedback(e.target.value)} placeholder="比如：主角改成女性，让结局更温暖" /></label><button type="button" className="outline-button" disabled={disabled || !feedback.trim() || dirty} onClick={() => onAction("revise", feedback.trim())}>按要求修改此方案</button><button type="button" className="inspiration-primary" disabled={disabled || dirty} onClick={() => onAction("analyze")}>选择并解析设定 <ArrowRight size={15} /></button>{dirty && <p className="studio-hint">请先保存方案修改，再使用 AI 或解析设定。</p>}</div>
    {error && <p className="studio-error" role="alert">{error}</p>}
  </article>;
}
