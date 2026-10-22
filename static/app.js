/* 短剧语料平台 - 前端主逻辑（视图切换 / 生成工作台 / 灵感索引 / 弹窗 / 溯源 / 系统指标） */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* 轻量排版：把 LLM 输出的 Markdown 装饰（**粗体**、场次行、【标记】、> 引用）转成可读 HTML */
const fmtText = (t) => esc(t)
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/(^|\n)((?:场\s*次?\s*[0-9一二三四五六七八九十百]+|第[0-9一二三四五六七八九十百]+场)[^\n]*)/g, "$1<b>$2</b>")
  .replace(/(^|\n)(【[^】]{1,40}】)/g, "$1<b>$2</b>")
  .replace(/(^|\n)\s*&gt;\s?([^\n]*)/g, '$1<i class="dim">$2</i>')
  .replace(/\n/g, "<br>");

const NODE_DEFS = {
  parse_idea: { idx: 1, title: "创意解析", desc: "提取题材 / 主角 / 核心冲突" },
  kb_search: { idx: 2, title: "知识检索", desc: "爆款语料 BM25 召回 + 节拍模板" },
  outline: { idx: 3, title: "剧集大纲", desc: "逐集梗概 + 钩子设计" },
  script: { idx: 4, title: "第1集剧本", desc: "场次 + 台词 + 情绪节拍" },
  quality_check: { idx: 5, title: "内容质检", desc: "规则 8 项 + 爆款潜力分 + 隐性 AI 味" },
  refine: { idx: 6, title: "精修改写", desc: "去模板词 / 口语化 / 补钩子" },
  scenes: { idx: 7, title: "分场拆解", desc: "结构化场景表" },
  storyboard: { idx: 8, title: "分镜脚本", desc: "景别 / 运镜 / 时长 / 音效" },
};
const ORDER = ["parse_idea", "kb_search", "outline", "script", "quality_check", "refine", "scenes", "storyboard"];
function syncNodeLabels() {
  for (const [key, def] of Object.entries(NODE_DEFS)) {
    def.title = window.t("nodeTitle_" + key);
    def.desc = window.t("nodeDesc_" + key);
    for (const id of ["node-" + key, "wnode-" + key]) {
      const node = document.getElementById(id);
      if (!node) continue;
      node.querySelector(".node-title").textContent = def.title;
      node.querySelector(".node-desc").textContent = def.desc;
    }
  }
}
syncNodeLabels();
document.addEventListener("duanju:locale", syncNodeLabels);


/* ---------- 通用：toast / 弹窗 ---------- */
function toast(msg, ok = true) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = "toast " + (ok ? "ok" : "err");
  t.style.display = "block";
  clearTimeout(t._tm);
  t._tm = setTimeout(() => (t.style.display = "none"), 2600);
}

function showModal(title, html) {
  const root = $("#modalRoot");
  root.innerHTML = `
    <div class="modal-mask" id="modalMask">
      <div class="modal">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" id="modalClose">✕</button></div>
        <div class="modal-body">${html}</div>
      </div>
    </div>`;
  $("#modalClose").onclick = closeModal;
  $("#modalMask").addEventListener("click", (e) => { if (e.target.id === "modalMask") closeModal(); });
}
function closeModal() { $("#modalRoot").innerHTML = ""; }

/* ---------- 服务状态 ---------- */
let LLM_MODEL = "LLM"; // 由 /api/health 返回实际模型名

async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    const j = await r.json();
    LLM_MODEL = j.model || "LLM";
    $("#statusDot").className = "dot ok";
    $("#svcStatus").dataset.state = "ok";
    $("#statusText").removeAttribute("data-i18n");
    $("#statusText").textContent = window.t("svcOk");
  } catch {
    $("#statusDot").className = "dot err";
    $("#svcStatus").dataset.state = "off";
    $("#statusText").removeAttribute("data-i18n");
    $("#statusText").textContent = window.t("svcOff");
  }
}

/* ---------- 视图切换 ---------- */
const inited = { hub: false, studio: true, graph: false, inspire: false, hooks: false, cats: false, writer: false, wb: false };

function switchView(v) {
  if (v === "create") v = window.WorkspaceUI?.creationMode() || "studio";
  if (!document.getElementById("view-" + v)) return;
  if (v !== "graph") window.GraphView?.onHidden?.();
  $$(".navtab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  ["hub", "studio", "graph", "inspire", "hooks", "cats", "writer", "wb"].forEach((k) => {
    const el = document.getElementById("view-" + k);
    if (el) el.classList.toggle("hidden", k !== v);
  });
  if (!inited[v]) {
    inited[v] = true;
    if (v === "hub" && window.HubView) window.HubView.activate();
    if (v === "graph" && window.GraphView) window.GraphView.activate();
    if (v === "hooks" && window.HooksView) window.HooksView.activate();
    if (v === "cats" && window.CatsView) window.CatsView.activate();
    if (v === "writer" && window.WriterView) window.WriterView.activate();
    if (v === "wb" && window.WBView) window.WBView.activate();
  } else {
    if (v === "graph" && window.GraphView) window.GraphView.onShown();
  }
  if (v === "inspire") initInspire();
  window.WorkspaceUI?.onView(v);
}
$$(".navtab").forEach((b) => b.addEventListener("click", () => switchView(b.closest("#mainnav") && b.dataset.view === "studio" ? (window.WorkspaceUI?.creationMode() || "studio") : b.dataset.view)));

/* ---------- 节点渲染（生成画布） ---------- */
function createNode(key) {
  const def = NODE_DEFS[key];
  const el = document.createElement("div");
  el.className = "node running open";
  el.id = `node-${key}`;
  el.innerHTML = `
    <div class="node-head">
      <span class="node-idx">${def.idx}</span>
      <div><div class="node-title">${def.title}</div><div class="node-desc">${def.desc}</div></div>
      <span class="node-state">${window.t("wGenerating")}</span>
    </div>
    <div class="node-body"><span class="dim small">${window.t("nodeRunning")}</span></div>`;
  el.querySelector(".node-head").addEventListener("click", () => el.classList.toggle("open"));
  $("#canvas").appendChild(el);
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return el;
}

function setNode(key, state, bodyHTML) {
  const el = document.getElementById(`node-${key}`);
  if (!el) return;
  el.classList.remove("running", "open");
  el.classList.add(state);
  const stateText = state === "done" ? "已完成 ✓" : "失败 ✗";
  el.querySelector(".node-state").textContent = stateText;
  if (state === "done" && bodyHTML) el.querySelector(".node-body").innerHTML = bodyHTML;
  if (state === "done") el.classList.add("open");
}

const renderParse = (d) => [
  [window.t("uiLogline"), d.logline], [window.t("uiGenre"), d.genre], [window.t("uiHero"), d.hero],
  [window.t("uiConflict"), d.conflict], [window.t("uiSelling"), d.selling_point],
].filter(([, v]) => v).map(([k, v]) => `<div><b class="small">${k}：</b>${esc(v)}</div>`).join("");

/* ---------- 质检 / 精修渲染 ---------- */
function renderQuality(d) {
  const scoreColor = d.score >= 80 ? "ok" : d.score >= 60 ? "warn" : "err";
  const rows = (d.checks || []).map((c) => `
    <div class="qc-row">
      <span>${c.ok ? "✓" : "✗"}</span>
      <b>${esc(c.item)}</b>
      <span class="dim small">${esc(c.detail)}</span>
    </div>`).join("");
  let llmHtml = `<p class="small dim">${window.t("uiNoLlmReview")}</p>`;
  const lr = d.llm_review;
  if (lr && lr.potential) {
    const p = lr.potential;
    const potColor = p.score >= 80 ? "ok" : p.score >= 60 ? "warn" : "err";
    const dims = [[window.t("uiHookStrength"), p.hook], [window.t("uiDensity"), p.cool], [window.t("uiPacing"), p.pacing],
                  [window.t("uiPaywall"), p.paywall], [window.t("uiResonance"), p.emotion]];
    const dimRows = dims.map(([k, v]) => `
      <div class="qc-row">
        <span>${v >= 80 ? "✓" : v >= 60 ? "~" : "✗"}</span>
        <b>${k}</b>
        <span class="dim small">${v}/100</span>
      </div>`).join("");
    const lv = (lr.ai_flavor || {}).level || "-";
    const lvCls = lv === "无" ? "ok" : lv === "轻" ? "warn" : "err";
    const issueRows = ((lr.ai_flavor || {}).issues || []).map((i) => `
      <div class="qc-row">
        <span>◆</span>
        <b>「${esc(i.quote)}」</b>
        <span class="dim small">${esc(i.why || "")} → ${esc(i.fix || "")}</span>
      </div>`).join("");
    llmHtml = `
    <div class="qc-head">${window.t("uiPotential")} <b class="qc-score ${potColor}">${p.score}</b>/100
      <span class="small dim">${esc(p.verdict || "")}</span></div>
    <div class="qc-list">${dimRows}</div>
    <div class="qc-head">${window.t("uiAiFlavor")}：<b class="${lvCls}">${esc(lv)}</b></div>
    <div class="qc-list">${issueRows || `<p class="small dim">${window.t("uiNoAiFlavor")}</p>`}</div>`;
  }
  return `
    <div class="qc-head">${window.t("uiQualityScore")} <b class="qc-score ${scoreColor}">${d.score}</b>/100
      <span class="small dim">${esc(d.summary || "")}</span></div>
    <div class="qc-list">${rows}</div>${llmHtml}`;
}

function renderRefine(d) {
  const delta = d.after_score - d.before_score;
  const rows = (d.changes || []).map((c) => `
    <div class="qc-row">
      <span>⚡</span>
      <b>${esc(c.item)} ×${c.count}</b>
      <span class="dim small">${esc((c.samples || []).join("；"))}</span>
    </div>`).join("");
  return `
    <div class="qc-head">${window.t("uiRevision")} <b>${esc(d.engine)}</b> · ${window.t("uiFixed")} <b>${d.issues_fixed}</b> ${window.t("uiItems")}
      · ${window.t("uiScore")} <b>${d.before_score}</b> → <b class="${delta > 0 ? "ok" : "dim"}">${d.after_score}</b>
      ${delta > 0 ? `<span class="ok">(+${delta})</span>` : ""}</div>
    <div class="qc-list">${rows || `<p class="small dim">${window.t("uiNoChanges")}</p>`}</div>
    <div class="small dim">${window.t("uiRecheck")}：${esc(d.after_summary || "")}</div>`;
}

const renderHits = (hits) => !hits || !hits.length ? `<span class="dim small">${window.t("uiNoMatch")}</span>` : hits.map((h) => `
  <div class="hit">
    <div class="hit-title"><span>《${esc(h.title)}》</span><span class="hit-score">BM25 ${h._score}</span></div>
    <div class="hit-meta">${esc(h.platform)} · ${esc(h.genre)} · ${window.t("uiHeat")} ${h.heat} · ${h.episodes}集</div>
    <div class="hit-hook"><b>${window.t("uiHook")}：</b>${esc(h.hook)}</div>
    <div class="hit-hook"><b>${window.t("uiReversal")}：</b>${esc(h.reversal)}</div>
    <div class="hit-tags">${(h.tags || []).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
  </div>`).join("");

const renderBeats = (t) => `<div class="small dim" style="margin-bottom:6px">${window.t("uiBeatTemplate")}（${window.t("uiReferences")}：${esc((t.reference_titles || []).join("、"))}）</div>
  <div class="hit-tags">${(t.common_beats || []).map((b) => `<span>${esc(b)}</span>`).join("")}</div>
  <div class="small" style="margin-top:8px"><b>${window.t("uiLessons")}：</b>${(t.lessons || []).map(esc).join("；")}</div>`;

const renderScenes = (d) => {
  const rows = (d.scenes || []).map((s) =>
    `<tr><td>${s.no}</td><td>${esc(s.location)}</td><td>${esc(s.time || "")}</td><td>${esc((s.characters || []).join("、"))}</td><td>${esc(s.summary)}</td></tr>`).join("");
  return `<table class="table"><tr><th>${window.t("uiScene")}</th><th>${window.t("uiLocation")}</th><th>${window.t("uiTime")}</th><th>${window.t("uiCharacters")}</th><th>${window.t("uiSynopsis")}</th></tr>${rows}</table>`;
};

const renderShots = (d) => {
  const rows = (d.shots || []).map((s) =>
    `<tr><td>${s.no}</td><td>${esc(s.type)}</td><td>${esc(s.camera)}</td><td>${esc(s.duration)}</td><td>${esc(s.desc)}</td><td>${esc(s.line || "—")}</td><td>${esc(s.sound || "")}</td></tr>`).join("");
  return `<table class="table"><tr><th>#</th><th>${window.t("uiShot")}</th><th>${window.t("uiCamera")}</th><th>${window.t("uiDuration")}</th><th>${window.t("uiVisual")}</th><th>${window.t("uiDialogue")}</th><th>${window.t("uiSound")}</th></tr>${rows}</table>`;
};

/* ---------- 生成流程（SSE） ---------- */
let generating = false;
let collecting = false;
let genDraft = null;  // 本次生成的剧本草稿（parse/outline/script 节点数据累积）
let genLibId = null;  // 生成完成后自动存入 AI 编剧库的条目 id

async function generate() {
  if (generating) return;
  generating = true;
  const btn = $("#btnGen");
  btn.disabled = true; btn.textContent = t("running");
  $("#canvas").innerHTML = "";
  $("#engineChip").textContent = `引擎：${LLM_MODEL} + BM25 知识库`;
  $("#engineChip").classList.add("on");
  genDraft = null; genLibId = null;
  $("#btnToWriter").classList.add("hidden");

  const body = {
    idea: $("#idea").value.trim(),
    genre: $("#genre").value,
    hero: $("#hero").value.trim(),
    episodes: +$("#episodes").value,
    market: window.duanjuMarket || "china",
    output_locale: $("#outputLocaleSelect")?.value || window.duanjuOutputLocale || window.duanjuLocale || "zh-CN",
    content_type: $("#contentTypeSelect")?.value || "short_drama",
  };
  // 小说模式附加参数（仅 novel 时随请求发送）
  if (body.content_type === "novel") {
    body.novel_length = $("#novelLengthSelect")?.value || "long";
    body.audience = $("#audienceSelect")?.value || "general";
    body.worldview = $("#worldview")?.value.trim() || "";
    body.words_per_chapter = +$("#wordsPerChapter")?.value || 0;
  }

  try {
    const resp = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!chunk.startsWith("data: ")) continue;
        handleEvent(JSON.parse(chunk.slice(6)));
      }
    }
    toast(t("genDone"), true);
  } catch (e) {
    console.error(e);
    toast(t("genFail") + "：" + e.message, false);
  } finally {
    generating = false;
    btn.disabled = false; btn.textContent = "▶ 启动生成 Agent";
  }
}

function handleEvent(ev) {
  const { node, status, data } = ev;
  if (node === "_done") {
    $("#engineChip").textContent = `引擎：完成 ✓（主角 ${data.hero} · ${data.genre}）`;
    saveGenToLibrary(); // 生成完成 → 自动存入 AI 编剧库
    return;
  }
  if (node === "_error") {
    toast(t("agentErr") + "：" + (data?.message || "未知错误"), false);
    return;
  }
  if (status === "running") { createNode(node); return; }
  if (status !== "done") return;

  // 捕获生成内容用于自动入库
  if (node === "parse_idea") {
    genDraft = { logline: data.logline || "", genre: data.genre || $("#genre").value,
                 hero: data.hero || $("#hero").value.trim(), outline: "", script: "" };
  } else if (node === "outline" && genDraft) {
    genDraft.outline = data.text || "";
  } else if (node === "script" && genDraft) {
    genDraft.script = data.text || "";
  }

  if (node === "parse_idea") {
    $("#engineChip").textContent = data._engine
      ? "引擎：本地模板兜底（LLM 不可用）"
      : `引擎：${LLM_MODEL} + BM25 知识库`;
  }

  let html = "";
  switch (node) {
    case "parse_idea": html = renderParse(data); break;
    case "kb_search":
      html = `<h3 style="margin-top:0">语料命中</h3>${renderHits(data.hits)}<h3>节拍模板</h3>${renderBeats(data.template)}`;
      showKbHits(data.hits);
      break;
    case "outline": html = `<div>${fmtText(data.text)}</div>`; break;
    case "script": html = `<div>${fmtText(data.text)}</div>`; break;
    case "quality_check": html = renderQuality(data); break;
    case "refine": html = renderRefine(data); break;
    case "scenes": html = renderScenes(data); break;
    case "storyboard": html = renderShots(data); break;
  }
  setNode(node, "done", html);
}

/* 生成完成 → 自动存入 AI 编剧库（data/library，TRAE 编剧工作台同源），可一键转续写 */
async function saveGenToLibrary() {
  if (!genDraft || !genDraft.script) { genDraft = null; return; }
  const ideaText = $("#idea").value.trim();
  const long = ideaText.length > 24;
  const title = (ideaText.slice(0, 24) || genDraft.logline.slice(0, 24) || "未命名剧本") + (long ? "…" : "");
  try {
    const r = await fetch("/api/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "", title, genre: genDraft.genre, hero: genDraft.hero,
        tags: [], hot_tags: [], outline: genDraft.outline, script: genDraft.script,
        created_at: 0, updated_at: 0,
      }),
    });
    const j = await r.json();
    if (j.ok) {
      genLibId = j.id;
      $("#btnToWriter").classList.remove("hidden");
      toast(t("savedLib", { title }), true);
    } else {
      toast(t("saveLibFail"), false);
    }
  } catch (e) {
    toast(t("saveLibFail") + "：" + e.message, false);
  } finally {
    genDraft = null;
  }
}

/* ---------- 知识库面板 ---------- */
async function kbSearch(q) {
  if (!q) return;
  const market = window.duanjuMarket || "";
  const locale = $("#outputLocaleSelect")?.value || "";
  const contentType = $("#contentTypeSelect")?.value || "";
  const r = await fetch(`/api/corpus/search?q=${encodeURIComponent(q)}&market=${encodeURIComponent(market)}&locale=${encodeURIComponent(locale)}&content_type=${encodeURIComponent(contentType)}`);
  const j = await r.json();
  showKbHits(j.hits);
}

function showKbHits(hits) {
  $("#kbHits").innerHTML = hits && hits.length
    ? hits.map((h) => `
      <div class="hit">
        <div class="hit-title"><span>《${esc(h.title)}》</span><span class="hit-score">BM25 ${h._score}</span></div>
        <div class="hit-meta">${esc(h.platform)} · ${esc(h.genre)} · ${window.t("uiHeat")} ${h.heat}</div>
        <div class="hit-hook">${esc(h.logline)}</div>
      </div>`).join("")
    : '<p class="small dim">无命中结果。</p>';
}

async function loadKbSummary() {
  const r = await fetch("/api/corpus");
  const j = await r.json();
  const genres = [...new Set(j.items.map((i) => i.genre.split("/")[0]))];
  $("#kbSummary").textContent = window.t("kbSummaryText", { n: j.count, genres: genres.join("、") });
}

/* ---------- 红果实时采集 ---------- */
async function collectHongguo() {
  if (collecting) return;
  collecting = true;
  const btn = $("#btnCollect");
  btn.disabled = true;
  $("#collectStatus").textContent = "采集中…（约 10-20 秒）";
  try {
    const r = await fetch("/api/collect", { method: "POST" });
    const j = await r.json();
    if (j.ok) {
      const srcs = (j.sources || []).filter((s) => s.ok).map((s) => s.source).join(" + ") || "采集";
      const gx = j.graph_extract;
      $("#collectStatus").textContent = gx
        ? `✓ 采集 ${j.count} 条（${srcs}）· 图谱新增 ${gx.processed} 部剧本`
        : `✓ 采集 ${j.count} 条（${srcs}）`;
      await loadKbSummary();
      await loadLeaderboard();
    } else {
      $("#collectStatus").textContent = "✗ 采集失败：" + (j.error || "未知错误");
    }
  } catch (e) {
    $("#collectStatus").textContent = "✗ 采集失败：" + e.message;
  } finally {
    collecting = false;
    btn.disabled = false;
  }
}

/* ---------- 语料深加工 / 人工导入 ---------- */
async function polishCorpus() {
  const btn = $("#btnPolish");
  if (btn.disabled) return;
  btn.disabled = true;
  $("#polishStatus").textContent = "AI 深加工中…（约 30-60 秒）";
  try {
    const r = await fetch("/api/corpus/polish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 20 }),
    });
    const j = await r.json();
    if (j.ok) {
      $("#polishStatus").textContent = `✓ 已深加工 ${j.polished} 条，剩余 ${j.remaining} 条`;
      toast(`语料深加工完成：${j.polished} 条钩子/反转/金句已补全（${j.elapsed_s}s）`, true);
      await loadKbSummary();
    } else {
      $("#polishStatus").textContent = "✗ 深加工失败";
      toast("深加工失败：" + (j.detail || "未知错误"), false);
    }
  } catch (e) {
    $("#polishStatus").textContent = "✗ 深加工失败：" + e.message;
  } finally {
    btn.disabled = false;
  }
}

function toggleImport(show) {
  $("#importBox").classList.toggle("hidden", !show);
  if (show) $("#importText").focus();
}

async function submitImport() {
  const text = $("#importText").value.trim();
  if (!text) { toast("请先粘贴语料内容", false); return; }
  const btn = $("#btnImportGo");
  btn.disabled = true;
  btn.textContent = "导入中…";
  try {
    const r = await fetch("/api/corpus/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const j = await r.json();
    if (j.ok) {
      toast(`导入成功（${j.fmt} 格式）：新增 ${j.imported} 条，库内共 ${j.total} 条`, true);
      $("#importText").value = "";
      toggleImport(false);
      await loadKbSummary();
    } else {
      toast("导入失败：" + (j.detail || "未解析到有效条目"), false);
    }
  } catch (e) {
    toast("导入失败：" + e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = "确认导入";
  }
}

/* ---------- 榜单 ---------- */
async function loadLeaderboard() {
  const r = await fetch("/api/leaderboard");
  const j = await r.json();
  $("#lbList").innerHTML =
    `<p class="small dim" style="margin-bottom:8px">${esc(j.source)} · 更新于 ${esc(j.updated)}</p>` +
    j.list.map((it) => `
      <div class="lb-item">
        <span class="lb-rank">${it.rank}</span>
        <div class="lb-main">
          <div class="lb-title">${esc(it.title)}</div>
          <div class="lb-meta">${esc(it.genre)}${it.tags && it.tags.length ? " · " + it.tags.map(esc).join("/") : ""}</div>
          ${it.logline ? `<div class="lb-logline">${esc(it.logline)}</div>` : ""}
        </div>
        <span class="lb-trend">${esc(it.trend || "")}</span>
        <span class="lb-heat">${it.heat}</span>
      </div>`).join("");
}

/* ---------- 灵感索引（视图3） ---------- */
let insInited = false;
const compareSel = [];

async function initInspire() {
  if (insInited) return;
  insInited = true;
  $("#btnSparkDraw").onclick = drawSpark;
  $("#btnSparkAI").onclick = aiSpark;
  $("#btnSparkLib").onclick = loadInspLibrary;
  drawSpark(); // 进入视图自动抽一批灵感卡
  try {
    const j = await fetch("/api/corpus").then((r) => r.json());
    const genres = [...new Set(j.items.map((i) => (i.genre || "").split("/")[0]).filter(Boolean))];
    $("#insTheme").innerHTML = `<option value="">${window.t("all")}</option>` + genres.map((g) => `<option>${esc(g)}</option>`).join("");
  } catch { /* 忽略 */ }
}

/* ---------- 灵感抽卡（B2/B3）：一次多张本地组合 + AI 批量生成 ---------- */
function sparkCardHTML(j, idx) {
  return `
    <div class="spark-card">
      <div class="spark-head">
        <span class="spark-badge">${window.t(j.open_hook?.from === "AI" ? "aiCard" : "ideaCard")}</span>
        <b class="spark-title">${esc(j.title)}</b>
        <span class="spark-sub">${esc(j.genre)} · ${esc(j.emotion)} · 「${esc(j.mechanism)}」</span>
        <span class="spark-actions">
          <button class="ghost sm spark-redraw" data-i="${idx}" data-i18n="swapIdea">${window.t("swapIdea")}</button>
          <button class="primary sm spark-use" data-i="${idx}" data-i18n="useStudio">${window.t("useStudio")}</button>
        </span>
      </div>
      <div class="spark-body">
        <div class="spark-row"><b data-i18n="uiHero">${window.t("uiHero")}</b><span>${esc(j.hero)}</span></div>
        <div class="spark-row"><b data-i18n="uiLogline">${window.t("uiLogline")}</b><span>${esc(j.logline)}</span></div>
        <div class="spark-row"><b data-i18n="openHook">${window.t("openHook")}</b><span>${esc(j.open_hook.text)} <span class="badge">${esc(j.open_hook.from)}${j.open_hook.mechanism ? " · " + esc(j.open_hook.mechanism) : ""} · ${window.t("hkIntensity")} ${j.open_hook.intensity}</span></span></div>
        <div class="spark-row"><b data-i18n="wLblBeats">${window.t("wLblBeats")}</b><span class="hit-tags">${(j.beats || []).map((b) => `<span>${esc(b)}</span>`).join("")}</span></div>
        <div class="spark-row"><b data-i18n="nodeTags">${window.t("nodeTags")}</b><span class="hit-tags">${(j.tags || []).map((t) => `<span>${esc(t)}</span>`).join("")}</span></div>
      </div>
    </div>`;
}

let sparkCards = []; // 当前展示的灵感卡（供 换/填入 按钮取用）

function renderSparkCards() {
  const box = $("#sparkCards");
  if (!sparkCards.length) {
    box.innerHTML = `<p class="empty-state">${window.t("inspirationEmpty")}</p>`;
    return;
  }
  box.innerHTML = sparkCards.map((c, i) => sparkCardHTML(c, i)).join("");
  $$(".spark-redraw").forEach((b) => (b.onclick = async () => {
    const j = await fetch(`/api/inspire/spark?n=1`).then((r) => r.json());
    sparkCards[+b.dataset.i] = j.cards[0];
    renderSparkCards();
  }));
  $$(".spark-use").forEach((b) => (b.onclick = () => fillStudio(sparkCards[+b.dataset.i])));
}

async function drawSpark() {
  const n = +($("#sparkN")?.value || 6);
  $("#sparkCards").innerHTML = `<p class="small dim" style="padding:8px 2px">${window.t("aiPreparing", { n })}</p>`;
  try {
    const j = await fetch(`/api/inspire/spark?n=${n}&market=${encodeURIComponent(window.duanjuMarket || "china")}`).then((r) => r.json());
    sparkCards = j.cards || [];
    renderSparkCards();
  } catch (e) {
    $("#sparkCards").innerHTML = `<p class="small dim" style="padding:8px 2px">抽卡失败：${esc(e.message)}</p>`;
  }
}

async function aiSpark() {
  const n = +($("#sparkN")?.value || 6);
  const hint = $("#sparkHint").value.trim();
  const btn = $("#btnSparkAI");
  btn.disabled = true;
  $("#sparkCards").innerHTML = `<p class="small dim" style="padding:8px 2px">${window.t("aiPreparing", { n })}</p>`;
  try {
    const r = await fetch("/api/inspire/spark_ai", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n, hint, market: window.duanjuMarket, output_locale: window.duanjuOutputLocale, content_type: $("#contentTypeSelect")?.value || "short_drama" }),
    });
    const j = await r.json();
    sparkCards = j.cards || [];
    renderSparkCards();
    toast(j.fallback ? window.t("aiFallback") : window.t("ideasGenerated", { n: sparkCards.length }), !j.fallback);
  } catch (e) {
    $("#sparkCards").innerHTML = `<p class="small dim" style="padding:8px 2px">AI 生成失败：${esc(e.message)}，试试 🎲 本地抽卡</p>`;
  } finally {
    btn.disabled = false;
  }
}

/* 把灵感卡种子填入生成工作台（B3） */
function fillStudio(spark) {
  const opts = [...$("#genre").options];
  const hit = opts.find((o) => o.value === spark.genre)
    || opts.find((o) => o.value.split("/").some((p) => p && spark.genre.includes(p)));
  if (hit) $("#genre").value = hit.value;
  $("#idea").value = `${spark.logline}\n${window.t("openHook")}（${spark.open_hook.from}）：${spark.open_hook.text}`;
  $("#hero").value = spark.hero || "";
  switchView("studio");
  toast(window.t("ideaLoaded", { title: spark.title }), true);
}

/* ---------- 灵感库（每日管线全量重建，不保留旧版本） ---------- */
function libCardHTML(j, idx) {
  return `
    <div class="spark-card">
      <div class="spark-head">
        <span class="spark-badge">${window.t("badgeKbInsp")}</span>
        <b class="spark-title">${esc(j.title)}</b>
        <span class="spark-sub">${esc(j.genre)} · ${esc(j.platform)}${j.author ? " · " + esc(j.author) : ""} · ${window.t("uiHeat")} ${j.heat ?? 0}</span>
        <span class="spark-actions">
          <button class="primary sm spark-lib-use" data-i="${idx}" data-i18n="useStudio">${window.t("useStudio")}</button>
        </span>
      </div>
      <div class="spark-body">
        <div class="spark-row"><b data-i18n="uiLogline">${window.t("uiLogline")}</b><span>${esc(j.logline)}</span></div>
        <div class="spark-row"><b data-i18n="openHook">${window.t("openHook")}</b><span>${esc(j.open_hook?.text || "—")} <span class="badge">${esc(j.open_hook?.from || "知识库")}${j.open_hook?.mechanism ? " · " + esc(j.open_hook.mechanism) : ""}</span></span></div>
        <div class="spark-row"><b data-i18n="wLblBeats">${window.t("wLblBeats")}</b><span class="hit-tags">${(j.beats || []).map((b) => `<span>${esc(b)}</span>`).join("")}</span></div>
        <div class="spark-row"><b data-i18n="nodeTags">${window.t("nodeTags")}</b><span class="hit-tags">${(j.tags || []).map((t) => `<span>${esc(t)}</span>`).join("")}</span></div>
        ${j.source_url ? `<div class="spark-row"><b data-i18n="originalSource">${window.t("originalSource")}</b><span><a href="${esc(j.source_url)}" target="_blank" rel="noopener">${window.t("openSource")} ↗</a></span></div>` : ""}
      </div>
    </div>`;
}

async function loadInspLibrary() {
  const box = $("#sparkCards");
  box.innerHTML = `<p class="empty-state">${window.t("loading")}</p>`;
  try {
    const j = await fetch(`/api/inspirations?market=${encodeURIComponent(window.duanjuMarket || "china")}`).then((r) => r.json());
    sparkCards = j.cards || [];
    if (!sparkCards.length) {
      box.innerHTML = '<p class="small dim" style="padding:8px 2px">灵感库为空：到知识图谱页点「📅 每日更新」跑一次管线即可重建</p>';
      return;
    }
    box.innerHTML = sparkCards.map((c, i) => libCardHTML(c, i)).join("");
    $$(".spark-lib-use").forEach((b) => (b.onclick = () => fillStudio(sparkCards[+b.dataset.i])));
    toast(`灵感库 ${j.count} 张（重建于 ${String(j.updated || "").slice(0, 16).replace("T", " ")}）`, true);
  } catch (e) {
    box.innerHTML = `<p class="small dim" style="padding:8px 2px">灵感库加载失败：${esc(e.message)}</p>`;
  }
}

async function doInspire() {
  const p = new URLSearchParams({
    q: $("#insQ").value.trim(), theme: $("#insTheme").value,
    emotion: $("#insEmotion").value, tag: $("#insTag").value.trim(),
  });
  $("#insMeta").textContent = "检索中…";
  const t0 = performance.now();
  const j = await fetch(`/api/inspire?${p}`).then((r) => r.json());
  const totalMs = Math.round(performance.now() - t0);
  $("#insMeta").textContent = `${j.count} 条 · 服务端 ${j.ms}ms · 往返 ${totalMs}ms`;
  $("#insList").innerHTML = j.count
    ? j.hits.map((h) => `
      <div class="hit">
        <div class="hit-title"><span>《${esc(h.title)}》</span><span class="hit-score">BM25 ${h._score}</span></div>
        <div class="hit-meta">${esc(h.genre)} · ${window.t("uiHeat")} ${h.heat}</div>
        <div class="hit-hook">${esc(h.logline)}</div>
        <div class="hit-hook small dim"><b>${window.t("uiHook")}：</b>${esc(h.hook || "")}</div>
        <div class="hit-tags">${(h.tags || []).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
        <div class="act-row">
          <button class="ghost sm" onclick="insRelated('drama:${esc(h.id)}')" data-i18n="uiRelated">${window.t("uiRelated")}</button>
          <button class="ghost sm" onclick="insCompareAdd('${esc(h.id)}','${esc(h.title).replace(/'/g, "&#39;")}')" data-i18n="uiCompare">${window.t("uiCompare")}</button>
          <button class="ghost sm" onclick="insLocate('${esc(h.title).replace(/'/g, "&#39;")}')" data-i18n="uiLocate">${window.t("uiLocate")}</button>
        </div>
      </div>`).join("")
    : `<div style="padding:18px 16px"><p>${window.t("uiNoHits")}</p>
        <p class="small dim" style="margin-top:6px">${window.t("inspirationEmpty")}</p></div>`;
}

async function insRelated(eid) {
  window.WorkspaceUI?.openDrawer("inspirationRelated");
  $("#insRelated").innerHTML = '<p class="small dim">计算关联度中…</p>';
  try {
    const resp = await fetch(`/api/inspire/related?eid=${encodeURIComponent(eid)}`);
    const j = await resp.json();
    if (!resp.ok) {
      $("#insRelated").innerHTML = `<p class="small dim">${esc(j.detail || "查询失败")}。<br/>该语料尚未抽取入知识图谱，请到「知识图谱」页点击 ⚡知识抽取 后重试。</p>`;
      return;
    }
    const list = j.related || [];
    $("#insRelated").innerHTML = list.length ? list.map((r) => `
      <div class="hit">
        <div class="hit-title"><span>${esc(r.name)}</span><span class="hit-score">${r.score}</span></div>
        <div class="small dim">文本 ${r.breakdown.text} · 标签 ${r.breakdown.tag} · 钩子 ${r.breakdown.hook}</div>
        <div class="hit-hook small">${esc((r.props.logline || "").slice(0, 60))}</div>
        ${r.complementary_tags && r.complementary_tags.length ? `<div class="hit-tags">${r.complementary_tags.map((t) => `<span>互补:${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="act-row">
          <button class="ghost sm" onclick="insCompareAdd('${esc(r.id)}','${esc(r.name).replace(/'/g, "&#39;")}')" data-i18n="uiCompare">${window.t("uiCompare")}</button>
        </div>
      </div>`).join("") : '<p class="small dim">图谱中暂无关联剧本。</p>';
  } catch (e) {
    $("#insRelated").innerHTML = `<p class="small dim">未找到图谱节点（${esc(e.message)}）</p>`;
  }
}

function insCompareAdd(ref, title) {
  if (compareSel.some((s) => s.ref === ref)) { toast("已在对比例表中"); return; }
  if (compareSel.length >= 2) { toast("对比栏最多 2 个，请先移除", false); return; }
  compareSel.push({ ref, title });
  renderCompareBar();
  window.WorkspaceUI?.openDrawer("inspirationRelated");
}

function renderCompareBar() {
  $("#compareBar").innerHTML = compareSel.length
    ? compareSel.map((s, i) =>
      `<div class="cmp-item"><span>《${esc(s.title)}》</span><button class="ghost sm" onclick="insCompareRm(${i})">✕</button></div>`).join("")
    : "未选择";
  $("#btnCompareGo").disabled = compareSel.length !== 2;
  $("#btnCompareGo").style.opacity = compareSel.length === 2 ? 1 : 0.5;
}
function insCompareRm(i) { compareSel.splice(i, 1); renderCompareBar(); }

async function insCompareGo() {
  if (compareSel.length !== 2) return;
  const j = await fetch("/api/compare", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a: compareSel[0].ref, b: compareSel[1].ref }),
  }).then((r) => r.json());
  const meta = (x) => `
    <div class="hit">
      <div class="hit-title"><span>《${esc(x.title)}》</span></div>
      <div class="hit-meta">${esc(x.genre)} · ${esc(x.author)} · ${esc(x.created_at)}</div>
      <div class="hit-tags">${(x.tags || []).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
      ${x.beats && x.beats.length ? `<div class="small" style="margin-top:6px"><b>结构：</b>${x.beats.map(esc).join(" → ")}</div>` : ""}
    </div>`;
  const mark = (t) => esc(t).replace(/⟪/g, '<mark class="dm">').replace(/⟫/g, "</mark>");
  showModal(`剧本对比 · 相似度 ${j.similarity}`, `
    <div class="compare-grid">
      <div>${meta(j.a)}<div class="diff-text">${mark(j.diff.a_marked)}</div></div>
      <div>${meta(j.b)}<div class="diff-text">${mark(j.diff.b_marked)}</div></div>
    </div>
    <p class="small dim" style="margin-top:8px"><mark class="dm">高亮</mark> = 相对对方文本的独有内容（字符级差异）</p>`);
}

function insLocate(title) {
  switchView("graph");
  $("#graphSearch").value = title;
  setTimeout(() => { window.GraphView && window.GraphView.load(); }, 80);
}

/* ---------- 溯源记录弹窗 ---------- */
async function showTraces() {
  const j = await fetch(`/api/traces?market=${encodeURIComponent(window.duanjuMarket || "china")}`).then((r) => r.json());
  showModal(`溯源记录（${j.count}）`, j.count ? `
    <p class="small dim">每次生成自动登记：引用知识节点 + 应用权重 + 图谱路径回溯。</p>
    ${j.items.map((t) => `
      <div class="hit">
        <div class="hit-title"><span>${esc(t.trace_id)}</span><span class="hit-score">${esc(t.created_at)}</span></div>
        <div class="hit-meta">题材 ${esc(t.req?.genre || "-")} · 引用 ${t.citations?.length || 0} 条 · ${esc((t.req?.idea || "").slice(0, 40))}</div>
        <div class="act-row"><button class="ghost sm" onclick="showTraceDetail('${esc(t.trace_id)}')">查看溯源详情</button></div>
      </div>`).join("")}` : '<p class="small dim">暂无记录，先在工作台生成一次剧本。</p>');
}

async function showTraceDetail(tid) {
  const t = await fetch(`/api/traces/${tid}`).then((r) => r.json());
  const bar = (w) => `<div class="wbar"><i style="width:${Math.round(w * 100)}%"></i></div>`;
  const paths = (t.graph_paths || []).map((p) => `
    <div class="hit"><div class="hit-title"><span>${esc(p.source)}</span><span class="hit-score">${p.hops} 跳</span></div>
    <div class="small dim">${p.nodes.map(esc).join(" → ")}</div></div>`).join("");
  showModal(`溯源详情 ${tid}`, `
    <h4 class="mb6">生成请求</h4>
    <div class="hit"><div class="hit-meta">题材 ${esc(t.req?.genre || "")} · 主角 ${esc(t.req?.hero || "")} · ${t.req?.episodes || "-"} 集</div>
      <div class="hit-hook">${esc(t.req?.idea || "")}</div></div>
    <h4 class="mb6">引用知识节点（权重 = score/max）</h4>
    ${(t.citations || []).map((c) => `
      <div class="hit"><div class="hit-title"><span>${esc(c.title)}</span><span class="hit-score">w=${c.weight}</span></div>
        ${bar(c.weight)}
        <div class="small dim">命中词：${(c.matched || []).map(esc).join("、") || "-"}</div></div>`).join("") || '<p class="small dim">无引用</p>'}
    <h4 class="mb6">图谱路径回溯（生成剧 → 来源）</h4>
    ${paths || '<p class="small dim">无路径（来源不在图谱中）</p>'}
    <h4 class="mb6">流水线步骤</h4>
    <div class="small dim">${(t.steps || []).map((s) => `${esc(s.node)}✓`).join(" → ")}</div>`);
}

/* ---------- 系统指标弹窗 ---------- */
async function showStats() {
  const j = await fetch("/api/stats").then((r) => r.json());
  const sla = j.sla_targets;
  const row = (name, val, target, ok) => `
    <tr><td>${esc(name)}</td><td class="${ok ? "ok-val" : "bad-val"}">${esc(val)}</td><td class="dim">${esc(target)}</td></tr>`;
  showModal("系统指标 · SLA 达标情况", `
    <div class="stats-grid">
      <div class="hit"><div class="hit-title"><span>语料库</span></div>
        <div class="small">样本 ${j.corpus.count} 条 ${j.corpus.live_meta ? `· 实时更新于 ${esc(j.corpus.live_meta.updated || "-")}` : ""}</div></div>
      <div class="hit"><div class="hit-title"><span>知识图谱</span></div>
        <div class="small">实体 ${j.graph.entities} · 关系 ${j.graph.relations} · 待审核 ${j.graph.pending_review}<br/>最近抽取：${esc(j.graph.last_extract_at || "-")}</div></div>
      <div class="hit"><div class="hit-title"><span>钩子库</span></div>
        <div class="small">共 ${j.hooks.total} · 待审核 ${j.hooks.pending} · 已通过 ${j.hooks.approved}</div></div>
      <div class="hit"><div class="hit-title"><span>数据新鲜度守护</span></div>
        <div class="small">上次巡检：${esc(j.scheduler.last_check || "-")}<br/>上次刷新：${esc(j.scheduler.last_refresh || "-")}</div></div>
    </div>
    <table class="table" style="margin-top:10px">
      <tr><th>SLA 指标</th><th>当前值</th><th>目标</th></tr>
      ${row("图谱数据准确率", j.graph.accuracy + "%", "≥" + sla.graph_accuracy_min + "%", j.graph.accuracy >= sla.graph_accuracy_min)}
      ${row("关系完整率", j.graph.relation_complete + "%", "≥" + sla.relation_complete_min + "%", j.graph.relation_complete >= sla.relation_complete_min)}
      ${row("数据更新频率", "≤24h（每小时巡检）", "≤" + sla.refresh_hours_max + "h", true)}
    </table>
    <p class="small dim" style="margin-top:8px">关联查询与 UI 响应在各视图实时展示（≤300ms / ≤100ms）。</p>`);
}

/* ---------- AI 方案配置（查看 / 修改 / 测试） ---------- */
async function openLlmCfg() {
  let cfg;
  try {
    cfg = await fetch("/api/llm/config").then((r) => r.json());
  } catch (e) {
    return toast("读取 AI 配置失败：" + e.message, false);
  }
  showModal("AI 方案配置", `
    <div class="llm-cfg">
      <div class="qc-row"><span id="llmCfgDot">${cfg.has_key ? "✓" : "✗"}</span>
        <b>当前方案</b><span>${esc(cfg.provider)} · ${esc(cfg.model)}${cfg.has_key ? "" : " · 未配置密钥（AI 功能不可用，走本地兜底）"}</span></div>
      <div class="qc-row"><span>ℹ</span><b>配置来源</b><span>${esc(cfg.source)}</span></div>
      <label style="display:block;margin-top:10px">API Base（OpenAI 兼容地址）</label>
      <input id="llmCfgBase" style="width:100%" value="${esc(cfg.api_base)}" />
      <label style="display:block;margin-top:8px">模型 ID</label>
      <input id="llmCfgModel" style="width:100%" value="${esc(cfg.model)}" />
      <label style="display:block;margin-top:8px">API Key（留空 = 保持不变${cfg.api_key_masked ? `，当前 ${esc(cfg.api_key_masked)}` : ""}）</label>
      <input id="llmCfgKey" type="password" style="width:100%" placeholder="${cfg.has_key ? "不修改请留空" : "sk-… / 方舟 API Key"}" />
      <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
        <button id="llmCfgSave" class="primary sm">💾 保存并生效</button>
        <button id="llmCfgTest" class="ghost sm">🔌 测试连接</button>
        <span id="llmTestOut" class="small dim"></span>
      </div>
      <p class="small dim" style="margin-bottom:0">保存后立即生效（无需重启），持久化到 data/llm_config.json，优先级高于 .env。支持火山方舟/百炼/DeepSeek/Kimi/GLM 等 OpenAI 兼容平台。</p>
    </div>`);
  $("#llmCfgSave").onclick = async () => {
    try {
      const r = await fetch("/api/llm/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: $("#llmCfgKey").value.trim(), api_base: $("#llmCfgBase").value.trim(), model: $("#llmCfgModel").value.trim() }),
      }).then((r) => r.json());
      if (!r.ok) return toast("保存失败", false);
      LLM_MODEL = r.model || LLM_MODEL;
      if ($("#engineChip").textContent.includes("待启动")) {
        $("#engineChip").textContent = `引擎：${LLM_MODEL} + BM25 知识库`;
      }
      closeModal();
      toast(`AI 配置已保存并生效：${r.provider} · ${r.model}${r.has_key ? "" : "（仍未配置密钥）"}`, true);
    } catch (e) {
      toast("保存失败：" + e.message, false);
    }
  };
  $("#llmCfgTest").onclick = async () => {
    const out = $("#llmTestOut");
    out.textContent = "测试中…";
    try {
      const r = await fetch("/api/llm/test", { method: "POST" }).then((r) => r.json());
      out.textContent = r.ok
        ? `✓ 连通正常 · ${r.latency_ms}ms · ${r.model}`
        : `✗ ${r.error || "不可用"}${r.has_key ? "" : " · 未配置密钥"}`;
      out.style.color = r.ok ? "" : "#e5484d";
    } catch (e) {
      out.textContent = "✗ 测试请求失败：" + e.message;
    }
  };
}

/* ---------- 初始化绑定 ---------- */
$("#btnGen").addEventListener("click", generate);
$("#btnLlmCfg").addEventListener("click", openLlmCfg);
$("#btnLlmCfgNav").addEventListener("click", openLlmCfg);
$("#btnToWriter").addEventListener("click", () => {
  if (!genLibId) return toast(window.t("noDraft"), false);
  switchView("writer");
  window.WriterView && window.WriterView.openContinueFromLibrary(genLibId);
});
$("#btnCollect").addEventListener("click", collectHongguo);
$("#btnPolish").addEventListener("click", polishCorpus);
$("#btnImport").addEventListener("click", () => toggleImport($("#importBox").classList.contains("hidden")));
$("#btnImportGo").addEventListener("click", submitImport);
$("#btnImportCancel").addEventListener("click", () => toggleImport(false));
$("#btnKbSearch").addEventListener("click", () => kbSearch($("#kbQuery").value.trim()));
$("#kbQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") kbSearch(e.target.value.trim()); });
$("#episodes").addEventListener("input", (e) => ($("#epVal").textContent = e.target.value));
/* 拆站后市场由 URL 决定（window.duanjuMarket 固定），不再提供页面内市场切换 */
/* 当前站点市场固定；仅同步站点默认输出语言和题材。 */
document.addEventListener("duanju:market", (e) => {
  const m = e.detail || "china";
  const ms = $("#marketSelect"); if (ms && ms.value !== m) ms.value = m;
  const ol = $("#outputLocaleSelect");
  if (ol && window.duanjuOutputLocale) ol.value = window.duanjuOutputLocale;
  swapGenreOptions(m);
});
$("#contentTypeSelect")?.addEventListener("change", (e) => {
  localStorage.setItem("duanju.contentType", e.target.value);
  const nov = $("#novelOpts");
  if (nov) nov.classList.toggle("hidden", e.target.value !== "novel");
});
$("#outputLocaleSelect")?.addEventListener("change", (e) => {
  window.duanjuOutputLocale = e.target.value;
  localStorage.setItem("duanju.outputLocale." + window.SITE_MARKET, e.target.value);
});

/* ---------- 题材选项随市场切换（日本市场使用日文题材体系，来自 agent/localization.JP_GENRES） ---------- */
const JP_GENRES = [
  "人生再生/恋愛", "悪役令嬢", "転生/やり直し", "ざまぁ/復讐",
  "溺愛/契約結婚", "異世界/スローライフ", "ダンジョン/成長",
  "職場女性/キャリア", "家庭/嫁姑", "ミステリー/推理",
  "地下アイドル/芸能", "BL",
];
const ZH_GENRES = ["逆袭/战神", "穿越/甜宠", "重生/复仇", "悬疑/都市", "古装/权谋", "末日/重生"];
function swapGenreOptions(market) {
  const list = market === "japan" ? JP_GENRES : ZH_GENRES;
  for (const sel of [$("#genre"), $("#wGenre")]) {
    if (!sel) continue;
    sel.innerHTML = list.map((g) => `<option>${esc(g)}</option>`).join("");
    sel.value = list[0];
  }
}
/* 供 writer.js 等模块联动题材下拉 */
window.swapDuanjuGenres = swapGenreOptions;
swapGenreOptions(window.duanjuMarket || "china");
if ($("#contentTypeSelect")) $("#contentTypeSelect").value = window.duanjuContentType || "short_drama";
$("#novelOpts")?.classList.toggle("hidden", $("#contentTypeSelect").value !== "novel");
if ($("#outputLocaleSelect")) $("#outputLocaleSelect").value = window.duanjuOutputLocale || window.duanjuLocale || "zh-CN";

/* 工作台右侧 tabs（仅 data-tab） */
$$("#view-studio .tab[data-tab]").forEach((t) =>
  t.addEventListener("click", () => {
    $$("#view-studio .tab[data-tab]").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $$("#view-studio .tab-body").forEach((b) => b.classList.add("hidden"));
    $("#tab-" + t.dataset.tab).classList.remove("hidden");
  })
);

/* 顶栏按钮 */
$("#btnTraceList").addEventListener("click", showTraces);
$("#btnStats").addEventListener("click", showStats);
$("#btnCompareGo").addEventListener("click", insCompareGo);
$("#btnCompareGo").disabled = true;
$("#btnCompareGo").style.opacity = 0.5;
$("#btnInspire").addEventListener("click", doInspire);
$("#insQ").addEventListener("keydown", (e) => { if (e.key === "Enter") doInspire(); });

const RANDOM_IDEAS = {
  china: [
    ["逆袭/战神", "被全家赶出门的上门女婿，深夜接到神秘电话后身份反转", "陈默，人前窝囊人后大佬"],
    ["重生/复仇", "被闺蜜和未婚夫联手害死的千金重生回18岁", "苏晚，带恨重生的千金"],
    ["穿越/甜宠", "社畜穿成反派恶毒小妾，一心只想抱大腿保命", "李甜甜，求生欲拉满的小妾"],
    ["末日/重生", "末日惨死后重生回一个月前，疯狂囤货带全家求生", "张岚，囤货狂魔妈妈"],
    ["悬疑/都市", "外卖员每次送餐都收到一张写有死亡时间的纸条", "赵四，撞破秘密的外卖员"],
  ],
  japan: [
    ["ざまぁ/復讐", "婚約破棄された夜、令嬢は前世の記憶を取り戻し、まず実家の乗っ取り計画を暴露する", "シャーロット、公爵令嬢"],
    ["悪役令嬢", "断罪の結末を迎えた悪役令嬢は、乙女ゲームの発売日に気づき三周目に入る", "カタリナ，断罪ループの悪役令嬢"],
    ["人生再生/恋愛", "ブラック企業を退職した翌日、田舎の古民家で焼きたてパンの匂いに包まれる", "結月，人生やり直し中の元OL"],
    ["溺愛/契約結婚", "政略結婚の相手は隣国の冷徹公爵——契約書の一項目に溺愛条項が紛れ込んでいた", "凛，契約結婚の大使令嬢"],
    ["ミステリー/推理", "地下アイドルの楽屋に毎週、誰かの「卒業予告」メモが残される", "蓮，気づいてしまったマネージャー"],
  ],
};
$("#btnRandom").addEventListener("click", () => {
  const pool = RANDOM_IDEAS[(window.duanjuMarket || "china") === "japan" ? "japan" : "china"];
  const [g, i, h] = pool[Math.floor(Math.random() * pool.length)];
  $("#genre").value = g; $("#idea").value = i; $("#hero").value = h;
});

checkHealth();
loadKbSummary();
loadLeaderboard();
