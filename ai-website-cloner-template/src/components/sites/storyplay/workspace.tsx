"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Download, FilePenLine, FileText, FolderOpen, LayoutGrid, Library, Plus, Save, Search, Sparkles, SquarePen, Upload, WandSparkles } from "lucide-react";
import { Header, Modal } from "./shared";
import { parseProjects, STORAGE_KEY, type CreationMode, type EditorTab, type Project } from "./data";

const createModes: Record<string, CreationMode> = { new: "新建剧本", adapt: "小说改编", rewrite: "剧本改写", inspiration: "灵感策划" };
const tabs: EditorTab[] = ["故事设定", "人物小传", "分集大纲", "剧本正文"];
const fieldMap = { "故事设定": "premise", "人物小传": "characters", "分集大纲": "outline", "剧本正文": "body" } as const;
const emptySnapshot = () => "";
function readSnapshot() {
  try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return "unavailable"; }
}
function subscribe(onChange: () => void) {
  const handler = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) onChange(); };
  window.addEventListener("storage", handler);
  window.addEventListener("storyplay-projects", onChange);
  return () => { window.removeEventListener("storage", handler); window.removeEventListener("storyplay-projects", onChange); };
}

export function Workspace() {
  const params = useSearchParams();
  const raw = useSyncExternalStore(subscribe, readSnapshot, emptySnapshot);
  const stored = useMemo(() => { try { return { projects: parseProjects(raw), error: "" }; } catch { return { projects: [] as Project[], error: "无法读取本机草稿，请先导出正在编辑的内容，避免覆盖旧数据。" }; } }, [raw]);
  const projects = stored.projects;
  const [mode, setMode] = useState<CreationMode | null>(() => createModes[params.get("create") || ""] || null);
  const [evaluation, setEvaluation] = useState(params.get("tool") === "evaluate");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部作品");
  const [draft, setDraft] = useState<Project | null>(null);
  const [tab, setTab] = useState<EditorTab>("故事设定");
  const [notice, setNotice] = useState("");
  const [aiDialog, setAiDialog] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [evalText, setEvalText] = useState("");
  function persist(next: Project[]) {
    if (stored.error) { setNotice(stored.error); return false; }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); window.dispatchEvent(new Event("storyplay-projects")); return true; }
    catch { setNotice("本机存储不可用或空间不足，请使用导出保存内容。"); return false; }
  }
  function save() {
    if (!draft) return;
    if (!draft.title.trim()) { setNotice("请填写作品名称后再保存。"); return; }
    const updated = { ...draft, title: draft.title.trim(), updatedAt: new Date().toISOString() };
    if (persist([updated, ...projects.filter(project => project.id !== draft.id)])) { setDraft(updated); setDirty(false); setNotice("草稿已保存到当前浏览器。"); }
  }
  function exportDraft() {
    if (!draft) return;
    const text = `${draft.title}\n${draft.genre} · ${draft.episodes}集 · ${draft.mode}\n\n故事设定\n${draft.premise}\n\n人物小传\n${draft.characters}\n\n分集大纲\n${draft.outline}\n\n剧本正文\n${draft.body}`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${draft.title.replace(/[\\/:*?"<>|]/g, "_")}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("已导出 TXT 文件。");
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") || "").trim();
    if (!title) return;
    const project: Project = { id: crypto.randomUUID(), title, mode: mode || "新建剧本", genre: String(data.get("genre")), audience: String(data.get("audience")), episodes: String(data.get("episodes")), premise: String(data.get("premise") || "").trim(), characters: "", outline: "", body: "", updatedAt: new Date().toISOString() };
    if (persist([project, ...projects])) { setDraft(project); setMode(null); setDirty(false); setTab("故事设定"); setNotice("作品已创建。可以继续编辑故事设定。"); }
  }
  const shown = projects.filter(project => project.title.toLowerCase().includes(query.trim().toLowerCase()) && (filter === "全部作品" || project.mode === filter));
  const warning = stored.error || (raw === "unavailable" ? "浏览器不允许本机存储，保存暂不可用，请导出草稿。" : "");
  return <div className="workspace-page"><Header workspace />
    <div className="studio-layout"><aside className="studio-sidebar"><div className="sidebar-label">创作空间</div>
      <button className={`sidebar-link ${!draft ? "selected" : ""}`} onClick={() => { if (dirty) { setNotice("请先保存或导出当前草稿，再返回作品列表。"); return; } setDraft(null); }}><LayoutGrid size={18} /> 我的作品</button>
      <Link className="sidebar-link" href="/lapian"><Library size={18} /> 短剧拉片 <ChevronRight size={14} /></Link>
      <button className="sidebar-link" onClick={() => setEvaluation(true)}><FilePenLine size={18} /> 剧本评估</button>
      <div className="sidebar-divider" /><div className="sidebar-label">创作工具</div>
      {(["新建剧本", "小说改编", "剧本改写", "灵感策划"] as CreationMode[]).map((item, index) => { const Icon = [SquarePen, BookOpen, WandSparkles, Sparkles][index]; return <button key={item} className="sidebar-link" onClick={() => { if (dirty) { setNotice("请先保存当前草稿，再创建新作品。"); return; } setMode(item); }}><Icon size={18} />{item}</button>; })}
      <div className="sidebar-foot"><span className="local-dot" /> 本机创作空间<p>无需登录 · 草稿仅存当前浏览器</p></div>
    </aside>
    <main className="studio-main">{warning && <div className="storage-warning" role="alert">{warning}</div>}
      {!draft ? <>
        <div className="workspace-title"><div><span className="eyebrow">YOUR CREATIVE SPACE</span><h1>我的作品<span>让每一个灵感，都有故事可讲</span></h1></div><button className="pill light" onClick={() => setMode("新建剧本")}><Plus size={17} /> 新建剧本</button></div>
        <div className="creation-grid">{([{ mode: "新建剧本", desc: "从一个想法，开始你的新故事", Icon: SquarePen, color: "cyan" }, { mode: "小说改编", desc: "将小说素材整理为短剧作品", Icon: BookOpen, color: "violet" }, { mode: "剧本改写", desc: "在已有故事上，探索更多可能", Icon: WandSparkles, color: "pink" }] as const).map(({mode: item, desc, Icon, color}) => <button className="creation-card" key={item} onClick={() => setMode(item)}><span className={`feature-icon ${color}`}><Icon size={22} /></span><h2>{item}</h2><p>{desc}</p><ArrowRight size={18} /></button>)}</div>
        <div className="works-toolbar"><div className="works-filters">{["全部作品", "新建剧本", "小说改编", "剧本改写", "灵感策划"].map(item => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><label className="search-field"><Search size={16} /><input aria-label="搜索作品" placeholder="搜索作品名称" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        {shown.length ? <div className="project-grid">{shown.map(project => <button key={project.id} className="project-card" onClick={() => { setDraft({...project}); setTab("故事设定"); setDirty(false); }}><div className="project-cover"><FileText size={40} /><span>{project.genre}</span><div className="cover-lines" /></div><div className="project-info"><h3>{project.title}</h3><p>{project.mode} · {project.episodes} 集</p><time>{new Date(project.updatedAt).toLocaleDateString("zh-CN")} 更新</time></div><ArrowRight size={17} /></button>)}</div> : <div className="empty-workspace"><div className="empty-icon"><FolderOpen size={44} strokeWidth={1} /><Sparkles size={17} /></div><h2>{projects.length ? "没有找到相关作品" : "你的下一个好故事，从这里开始"}</h2><p>{projects.length ? "换一个搜索词，或查看其他作品分类。" : "新建一个剧本，把脑海里的灵感变成故事。"}</p>{!projects.length && <button className="outline-button" onClick={() => setMode("新建剧本")}><Plus size={16} /> 创建第一部作品</button>}</div>}
        <p className="workspace-disclaimer">创作工作台为交互原型 · AI 生成与评估服务待接入</p>
      </> : <>
        <div className="editor-top"><button className="icon-button" aria-label="返回我的作品" onClick={() => { if (dirty) { setNotice("请先保存或导出当前草稿。"); return; } setDraft(null); }}><ArrowLeft size={20} /></button><div><input className="project-title-input" aria-label="作品名称" maxLength={60} value={draft.title} onChange={event => { setDraft({...draft,title:event.target.value}); setDirty(true); }} /><p>{draft.genre} / {draft.episodes} 集 / {draft.audience}</p></div><div className="editor-actions"><span className="save-state">{dirty ? "有未保存修改" : "已保存本机"}</span><button className="outline-button" onClick={exportDraft}><Download size={16} /> 导出</button><button className="pill light" onClick={save}><Save size={16} /> 保存草稿</button></div></div>
        <div className="editor-tabs" role="tablist" aria-label="剧本编辑步骤">{tabs.map((item,index) => <button role="tab" aria-selected={item === tab} aria-controls="editor-panel" id={`editor-tab-${index}`} key={item} className={item === tab ? "active" : ""} onClick={() => setTab(item)}><span>0{index+1}</span>{item}</button>)}</div>
        <div className="editor-panel" id="editor-panel" role="tabpanel" aria-labelledby={`editor-tab-${tabs.indexOf(tab)}`}><div className="editor-panel-heading"><div><h2>{tab}</h2><p>{tab === "故事设定" ? "梳理故事核心，构建创作的起点" : tab === "人物小传" ? "记录角色背景、性格、动机与人物关系" : tab === "分集大纲" ? "按集梳理关键事件、情绪转折与悬念" : "以场景、动作与对白，写下你的故事"}</p></div><button className="outline-button" onClick={() => setAiDialog(true)}><Sparkles size={15} /> AI辅助创作</button></div><textarea className="script-editor" aria-label={tab} placeholder={tab === "故事设定" ? "故事发生在什么地方？主角是谁？TA 想要什么，又会遇到怎样的阻碍？\n\n在这里写下你的故事想法……" : tab === "人物小传" ? "人物姓名：\n身份背景：\n核心欲望：\n性格特征：\n人物关系：" : tab === "分集大纲" ? "第1集\n开场：\n冲突：\n转折：\n集尾悬念：" : "第1集\n\n1-1  日  内  场景名称\n人物：\n\n△ 动作与场景描述\n\n角色：对白内容……"} value={draft[fieldMap[tab]]} onChange={event => { setDraft({...draft,[fieldMap[tab]]:event.target.value}); setDirty(true); }} /><div className="editor-bottom"><span>{draft[fieldMap[tab]].replace(/\s/g, "").length} 字</span><span>手动编辑 · 点击保存后保存在本机</span></div></div>
        <div className="editor-next">{tab !== "剧本正文" && <button className="pill light" onClick={() => setTab(tabs[tabs.indexOf(tab)+1])}>下一步：{tabs[tabs.indexOf(tab)+1]} <ArrowRight size={16} /></button>}</div>
      </>}
    </main></div>
    {notice && <div className="notice" role="status"><Check size={16} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="关闭提示">×</button></div>}
    {mode && <Modal title={mode} wide onClose={() => setMode(null)}><p className="modal-description">{mode === "新建剧本" ? "先写下故事的基本信息，开启创作。" : mode === "小说改编" ? "粘贴小说梗概或片段，先建立你的改编草稿。" : mode === "剧本改写" ? "导入原有故事内容，建立独立的改写草稿。" : "记下一个灵感，让故事从这里生长。"}</p><form onSubmit={create} className="create-form"><label>作品名称 <span>*</span><input name="title" required maxLength={60} placeholder="给你的故事起个名字" /></label><div className="form-row"><label>题材类型<select name="genre">{["都市", "甜宠", "古装", "悬疑", "玄幻", "家庭", "其他"].map(item => <option key={item}>{item}</option>)}</select></label><label>目标受众<select name="audience"><option>不限</option><option>女性向</option><option>男性向</option></select></label><label>计划集数<select name="episodes">{[12,24,40,60,80,100].map(n => <option key={n}>{n}</option>)}</select></label></div><label>{mode === "小说改编" ? "小说素材" : mode === "剧本改写" ? "原剧本内容" : "故事想法"}<textarea name="premise" maxLength={50000} rows={6} placeholder={mode === "小说改编" ? "粘贴小说简介、章节片段或改编思路……" : "故事发生在哪里？人物之间有什么冲突？\n写下你的想法，稍后可以继续补充。"} /></label><p className="form-note">这里只建立草稿，不会调用 AI 或提交内容到原站。</p><div className="modal-actions"><button type="button" className="text-button" onClick={() => setMode(null)}>取消</button><button type="submit" className="pill light">创建作品 <ArrowRight size={15} /></button></div></form></Modal>}
    {aiDialog && <Modal title="AI 辅助创作" onClose={() => setAiDialog(false)}><div className="dialog-symbol"><Sparkles size={30} /></div><h3 className="dialog-subtitle">故事已就绪，AI 能力等待接入</h3><p className="modal-description">当前版本用于预览前端流程，暂不生成 AI 内容。你可以继续手动编辑、保存和导出草稿。</p><div className="modal-actions"><button className="pill light" onClick={() => setAiDialog(false)}>继续编辑</button></div></Modal>}
    {evaluation && <Modal title="剧本评估" wide onClose={() => setEvaluation(false)}><p className="modal-description">先导入需要评估的剧本。当前仅预览导入界面，暂不生成评分。</p><label className="upload-area"><Upload size={26} /><strong>选择 TXT 剧本文件</strong><span>或在下方直接粘贴正文 · 最大 2 MB</span><input type="file" accept=".txt,text/plain" onChange={async event => { const file=event.target.files?.[0]; if (!file) return; if(file.size > 2*1024*1024) {setNotice("请选择 2 MB 以内的 TXT 文件。");return;} try { setEvalText(await file.text()); } catch { setNotice("文件读取失败，请重新选择。"); } event.target.value=""; }} /></label><label className="evaluation-text">剧本内容<textarea rows={8} value={evalText} onChange={event => setEvalText(event.target.value)} placeholder="粘贴需要评估的剧本内容……" /></label><div className="evaluation-foot"><span>{evalText.replace(/\s/g, "").length} 字</span><span>评估服务待接入</span></div><div className="modal-actions"><button className="pill light" onClick={() => { if (!evalText.trim()) {setNotice("请先导入或粘贴剧本内容。");return;} setNotice("内容已在当前评估窗口中载入。AI 评估服务尚未接入。"); }}>检查导入内容 <Check size={15} /></button></div></Modal>}
  </div>;
}
