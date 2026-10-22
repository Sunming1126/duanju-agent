/* 钩子工作台 — 钩子库 CRUD / 三属性标准 / 版本与审核 / 智能抽取 / 结构模板 / 小说转化 */
window.HooksView = (() => {
  let taxo = { categories: [], positions: [], mechanisms: [] };
  let current = null;        // 当前编辑钩子
  let curStatus = "";        // 列表过滤状态
  let curCat = "";           // 类别过滤（C2 chip）
  let _allHooks = [];        // 全量缓存（统计概览 / 配方池共用）
  let _lastRecipe = [];      // 最近一次抽出的配方组合
  const posLabel = (p) => window.t({ open: "hkPosOpen", mid: "hkPosMid", tail: "hkPosTail" }[p] || "") || p;
  const stLabel = (s) => window.t({ auto_pass: "hkStAuto", pending: "hPending", approved: "hApproved", rejected: "hRejected" }[s] || "") || s;
  const POS_CN = new Proxy({}, { get: (_, k) => posLabel(k) });
  const ST_CN = new Proxy({}, { get: (_, k) => stLabel(k) });
  const ST_CLS = { auto_pass: "st-auto", pending: "st-pending", approved: "st-approved", rejected: "st-rejected" };
  const isApproved = (h) => h.status === "approved" || h.status === "auto_pass";

  /* ---------- 钩子列表（C2：全量拉取 → 统计概览 + 状态/类别双维过滤） ---------- */
  async function loadHooks() {
    const j = await fetch(`/api/hooks?market=${encodeURIComponent(window.duanjuMarket || "china")}`).then((r) => r.json());
    taxo = j.taxonomy || taxo;
    _allHooks = j.items || [];
    fillRecipeMechs();
    renderStats();
    renderList();
  }

  function renderStats() {
    const box = document.getElementById("hookStats");
    const pending = _allHooks.filter((h) => h.status === "pending").length;
    const approved = _allHooks.filter(isApproved).length;
    const byCat = {};
    _allHooks.forEach((h) => (byCat[h.category] = (byCat[h.category] || 0) + 1));
    const chips = ["", ...Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])].map((c) =>
      `<button class="cat-chip ${curCat === c ? "active" : ""}" data-cat="${esc(c)}">${c ? esc(c) + " " + byCat[c] : window.t("all") + " " + _allHooks.length}</button>`).join("");
    box.innerHTML = `
      <div class="hook-stat-row">
        <span>${window.t("uiTotal")} <b>${_allHooks.length}</b></span>
        <span class="st-pending">${window.t("uiPending")} <b>${pending}</b></span>
        <span class="st-approved">${window.t("uiApproved")} <b>${approved}</b></span>
        ${pending > 0 ? '<button class="primary sm" id="btnAutoReview">' + window.t("hkAutoReview") + '</button>' : ""}
        ${curStatus === "pending" && pending > 0 ? '<button class="ghost sm" id="btnBulkApprove">' + window.t("hkBulkApprove") + '</button>' : ""}
      </div>
      <div class="cat-chips">${chips}</div>`;
    box.querySelectorAll(".cat-chip").forEach((t) =>
      t.addEventListener("click", () => { curCat = t.dataset.cat; renderStats(); renderList(); }));
    const ba = document.getElementById("btnBulkApprove");
    if (ba) ba.addEventListener("click", bulkApprove);
    const ar = document.getElementById("btnAutoReview");
    if (ar) ar.addEventListener("click", autoReview);
  }

  function renderList() {
    const box = document.getElementById("hookList");
    const items = _allHooks.filter((h) =>
      (!curStatus || h.status === curStatus) && (!curCat || h.category === curCat));
    box.innerHTML = items.length
      ? items.map((h) => `
        <div class="hit hook-item ${current && current.id === h.id ? "sel" : ""}" data-hid="${esc(h.id)}">
          <div class="hit-title"><span>${esc(h.name)}</span><span class="badge ${ST_CLS[h.status] || ""}">${ST_CN[h.status] || esc(h.status)}</span></div>
          <div class="hit-meta">${esc(h.category)} · ${POS_CN[h.position] || h.position} · ${esc(h.mechanism)} · ${window.t("hkIntensity")} ${"★".repeat(h.intensity || 0)}${h.auto_score != null ? ` · <b class="dim">AI ${h.auto_score}</b>` : ""}</div>
          <div class="hit-hook small">${esc((h.text || "").slice(0, 60))}</div>
        </div>`).join("")
      : `<p class="small dim">${window.t("uiNoHooks")}</p>`;
    box.querySelectorAll(".hook-item").forEach((el) =>
      el.addEventListener("click", () => {
        const h = items.find((x) => x.id === el.dataset.hid);
        if (h) openEditor(h);
      }));
  }

  /* ---------- C5：批量审核（待审核 tab 一键全部通过） ---------- */
  async function bulkApprove() {
    const j = await fetch("/api/hooks/bulk_review", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all_pending: true, approved: true }),
    }).then((r) => r.json());
    window.toast(window.t("hkBatchDone", { n: j.count }));
    current = null;
    document.getElementById("hookChip").textContent = window.t("hNotSelected");
    document.getElementById("hookEditor").innerHTML =
      `<p class="small dim" style="padding:16px">${window.t("hookEmpty")}</p>`;
    await loadHooks();
  }

  /* ---------- 智能审核：查重拒收 + LLM 四维评审自动分流 ---------- */
  async function autoReview() {
    const btn = document.getElementById("btnAutoReview");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = window.t("hkReviewing");
    try {
      const j = await fetch("/api/hooks/auto_review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).then((r) => r.json());
      if (j.detail) { window.toast(window.t("hkAutoFail") + j.detail, "err"); return; }
      const parts = [window.t("hkPassN", { n: j.approved })];
      if (j.dup_rejected) parts.push(window.t("hkDupRej", { n: j.dup_rejected }));
      parts.push(window.t("hkRejN", { n: j.rejected }), window.t("hkKeptN", { n: j.kept_pending }));
      if (j.llm_used === false) parts.push(window.t("hkNoLlm"));
      window.toast(window.t("hkAutoDone", { parts: parts.join(" · "), s: j.elapsed_s || 0 }));
      const list = (j.details || []);
      const low = list.filter((d) => d.verdict === "approved" && d.score != null && d.score < 85);
      if (low.length) window.toast(window.t("hkEdgeHint", { n: low.length }));
    } catch (e) {
      window.toast(window.t("hkAutoErr") + (e.message || e), "err");
    } finally {
      btn.disabled = false;
      btn.textContent = window.t("hkAutoReview");
      current = null;
      document.getElementById("hookChip").textContent = "未选中";
      document.getElementById("hookEditor").innerHTML =
        `<p class="small dim" style="padding:16px">${window.t("hookEmpty")}</p>`;
      await loadHooks();
    }
  }

  /* ---------- 编辑器 ---------- */
  const opt = (arr, sel, cn) => arr.map((v) =>
    `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc((cn && cn[v]) || v)}</option>`).join("");

  function openEditor(h) {
    current = h || null;
    document.getElementById("hookChip").textContent = current ? current.id : "新建";
    $$("#hookList .hook-item").forEach((el) => el.classList.toggle("sel", !!current && el.dataset.hid === current.id));
    const ed = document.getElementById("hookEditor");
    ed.innerHTML = current ? `
      <div class="fgrid">
        <div><label>名称</label><input id="heName" value="${esc(current.name)}"/></div>
        <div><label>类别</label><select id="heCat">${opt(taxo.categories, current.category)}</select></div>
      </div>
      <label>钩子文本</label>
      <textarea id="heText" rows="3">${esc(current.text)}</textarea>
      <div class="fgrid">
        <div><label data-i18n="hkPosLabel">${window.t("hkPosLabel")}</label><select id="hePos">${opt(taxo.positions, current.position, POS_CN)}</select></div>
        <div><label>机制</label><select id="heMech">${opt(taxo.mechanisms, current.mechanism)}</select></div>
      </div>
      <label>强度：<span id="heIntVal">${current.intensity}</span> / 5</label>
      <input type="range" id="heInt" min="1" max="5" value="${current.intensity || 3}"/>
      <label>标签（逗号分隔）</label>
      <input id="heTags" value="${esc((current.tags || []).join(","))}"/>
      <label>备注</label>
      <input id="heNote" value="${esc(current.note || "")}"/>
      <div class="act-row">
        <button id="heSave" class="primary sm">💾 保存（版本 +1）</button>
        ${current.status === "pending" ? `
          <button id="heOk" class="primary sm">✓ 审核通过</button>
          <button id="heNo" class="ghost sm" data-i18n="hkRejectBtn">${window.t("hkRejectBtn")}</button>` : ""}
        <button id="heUse" class="ghost sm">▶ 用此钩子生成</button>
      </div>
      ${current.auto_score != null ? `
      <p class="small dim">🤖 AI 评审：综合 <b>${current.auto_score}</b> 分${
        current.auto_dims ? ` · 强度${current.auto_dims.hook}/可拍${current.auto_dims.filmable}/风险${current.auto_dims.risk}/新颖${current.auto_dims.novelty}` : ""}${
        current.review_note && current.review_note.note ? `<br/>${esc(current.review_note.note)}` : ""}</p>` : ""}
      <h4>版本历史（${(current.versions || []).length}）</h4>
      ${(current.versions || []).map((v) => `
        <div class="ver-row small"><b>v${v.v}</b> <span class="dim">${esc(v.edited_at || "")}</span>
        <div>${esc(v.text || "")}</div>${v.note ? `<span class="dim">${esc(v.note)}</span>` : ""}</div>`).join("") || '<p class="small dim">暂无版本记录</p>'}
      <p class="small dim" style="margin-top:8px">${window.t("hkLinked")}${esc(current.graph_entity || window.t("hkSyncAfter"))}</p>
    ` : `
      <div class="fgrid">
        <div><label data-i18n="hkName">${window.t("hkName")}</label><input id="heName" placeholder="${window.t("hkNamePh")}"/></div>
        <div><label>类别</label><select id="heCat">${opt(taxo.categories, "悬念钩")}</select></div>
      </div>
      <label>钩子文本</label>
      <textarea id="heText" rows="3" placeholder="${window.t("hkTextPh")}"></textarea>
      <div class="fgrid">
        <div><label data-i18n="hkPosLabel">${window.t("hkPosLabel")}</label><select id="hePos">${opt(taxo.positions, "open", POS_CN)}</select></div>
        <div><label data-i18n="hkMech">${window.t("hkMech")}</label><select id="heMech">${opt(taxo.mechanisms, "悬念")}</select></div>
      </div>
      <label>强度：<span id="heIntVal">3</span> / 5</label>
      <input type="range" id="heInt" min="1" max="5" value="3"/>
      <label>标签（逗号分隔）</label>
      <input id="heTags" placeholder="${window.t("hkTagsPh")}"/>
      <label>备注</label>
      <input id="heNote" value=""/>
      <div class="act-row"><button id="heSave" class="primary sm">＋ 创建钩子</button></div>
    `;
    ed.querySelectorAll("[id^=heInt]").forEach((el) => {
      if (el.id === "heInt") el.addEventListener("input", () => (document.getElementById("heIntVal").textContent = el.value));
    });
    const save = ed.querySelector("#heSave");
    if (save) save.addEventListener("click", saveHook);
    const ok = ed.querySelector("#heOk");
    if (ok) ok.addEventListener("click", () => review(true));
    const no = ed.querySelector("#heNo");
    if (no) no.addEventListener("click", () => review(false));
    const use = ed.querySelector("#heUse");
    if (use) use.addEventListener("click", () => useHook(current));
  }

  /* ---------- C4：消费出口——把单条钩子带去工作台 ---------- */
  function useHook(h) {
    const idea = document.getElementById("idea");
    if (idea) idea.value = `围绕${POS_CN[h.position] || h.position}钩子「${h.text}」（类别：${h.category}）展开一部短剧`;
    switchView("studio");
    window.toast(window.t("hkUseIdea"), true);
  }

  /* ---------- C3：钩子配方（开场/中段/结尾组合抽取 → 一键带去工作台） ---------- */
  function fillRecipeMechs() {
    ["rcpMechOpen", "rcpMechMid", "rcpMechTail"].forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel || sel.options.length > 1) return;
      sel.innerHTML = '<option value="">不限机制</option>' +
        (taxo.mechanisms || []).map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    });
  }

  function drawRecipe() {
    const approved = _allHooks.filter(isApproved);
    const rows = [["open", "rcpMechOpen"], ["mid", "rcpMechMid"], ["tail", "rcpMechTail"]];
    _lastRecipe = rows.map(([pos, selId]) => {
      const mech = document.getElementById(selId).value;
      let pool = approved.filter((h) => h.position === pos && (!mech || h.mechanism === mech));
      if (!pool.length) pool = approved.filter((h) => h.position === pos); // 机制无匹配时放宽
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    });
    const out = document.getElementById("recipeOut");
    out.innerHTML = _lastRecipe.map((h, i) => h
      ? `<div class="hit"><div class="hit-title"><span>${POS_CN[rows[i][0]]} · ${esc(h.category)}</span><span class="hit-score">${esc(h.mechanism)} · ${window.t("hkIntensity")} ${h.intensity}</span></div><div class="small">${esc(h.text)}</div></div>`
      : `<div class="hit"><div class="hit-title"><span>${POS_CN[rows[i][0]]}</span></div><p class="small dim">${window.t("hkNoApproved")}</p></div>`).join("")
      + (_lastRecipe.some(Boolean)
        ? '<div class="act-row"><button id="btnRecipeUse" class="primary sm">▶ 用这组钩子去生成</button></div>'
        : '<p class="small dim">库内暂无已通过钩子，先去审核或创建。</p>');
    const btn = document.getElementById("btnRecipeUse");
    if (btn) btn.addEventListener("click", useRecipe);
  }

  function useRecipe() {
    const hs = _lastRecipe.filter(Boolean);
    if (!hs.length) { window.toast(window.t("hkNoHooks"), false); return; }
    // 类别 → 工作台题材方向（按占比最高的类别推断）
    const GENRE_BY_CAT = { "危机钩": "末日/重生", "悬念钩": "悬疑/都市", "金句钩": "逆袭/战神",
                           "期待钩": "逆袭/战神", "反转钩": "重生/复仇", "身份钩": "逆袭/战神", "标题钩": "逆袭/战神" };
    const catCount = {};
    hs.forEach((h) => (catCount[h.category] = (catCount[h.category] || 0) + 1));
    const topCat = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0][0];
    const genre = window.duanjuMarket === "japan"
      ? ({ "危机钩": "ミステリー/推理", "悬念钩": "ミステリー/推理", "反转钩": "ざまぁ/復讐", "身份钩": "溺愛/契約結婚" }[topCat] || "人生再生/恋愛")
      : GENRE_BY_CAT[topCat];
    if (genre) document.getElementById("genre").value = genre;
    document.getElementById("idea").value =
      window.t("recipeIdea") + "\n" + hs.map((h) => `【${POS_CN[h.position]}·${h.category}】${h.text}`).join("\n");
    switchView("studio");
    window.toast(window.t("hkRecipeDone"), true);
  }

  async function saveHook() {
    const body = {
      name: document.getElementById("heName").value.trim(),
      text: document.getElementById("heText").value.trim(),
      category: document.getElementById("heCat").value,
      position: document.getElementById("hePos").value,
      mechanism: document.getElementById("heMech").value,
      intensity: +document.getElementById("heInt").value,
      tags: document.getElementById("heTags").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      note: document.getElementById("heNote").value.trim(),
    };
    if (!body.name || !body.text) { window.toast(window.t("hkNeedNameText"), false); return; }
    try {
      const j = current
        ? await fetch(`/api/hooks/${encodeURIComponent(current.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json())
        : await fetch("/api/hooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, status: "pending", market: window.duanjuMarket || "china" }) }).then((r) => r.json());
      window.toast(current ? window.t("hkSaved") : window.t("hkCreated"));
      await loadHooks();
      openEditor(j.hook || j);
    } catch (e) { window.toast(window.t("hkSaveFail") + e.message, false); }
  }

  async function review(approved) {
    if (!current) return;
    const j = await fetch(`/api/hooks/${encodeURIComponent(current.id)}/review`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    }).then((r) => r.json());
    window.toast(approved ? window.t("hkApprovedMsg") : window.t("hkRejectedMsg"));
    await loadHooks();
    openEditor(j.hook || j);
  }

  /* ---------- 智能抽取 ---------- */
  async function extractText() {
    const text = document.getElementById("extText").value.trim();
    if (!text) { window.toast(window.t("hkPasteText"), false); return; }
    const box = document.getElementById("extResult");
    box.innerHTML = '<p class="small dim">抽取中…</p>';
    const j = await fetch("/api/hooks/extract", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, save: true }),
    }).then((r) => r.json());
    box.innerHTML = `
      <p>识别 <b>${(j.found || []).length}</b> 个潜在钩子，入库 <b>${j.saved}</b> 个（待审核）</p>
      ${(j.found || []).map((f) => `
        <div class="hit"><div class="hit-title"><span>${esc(f.name)}</span><span class="hit-score">${esc(f.category)}·${esc(f.mechanism)}</span></div>
        <div class="small">${esc(f.text)}</div></div>`).join("") || `<p class="small dim">${window.t("hkNoFound")}</p>`}`;
    await loadHooks();
  }

  async function extractAll() {
    const btn = document.getElementById("btnHookExtractAll");
    btn.disabled = true;
    const box = document.getElementById("extResult");
    box.innerHTML = `<p class="small dim">${window.t("hkExtractAlling")}</p>`;
    try {
      const j = await fetch("/api/hooks/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 3, use_llm: false }),
      }).then((r) => r.json());
      const s = j.stats || j;
      box.innerHTML = `<p>${window.t("hkStat", { p: s.processed ?? "-", e: s.entities ?? "-", r: s.relations ?? "-", h: s.hooks_new ?? "-" })}</p>`;
      await loadHooks();
    } finally { btn.disabled = false; }
  }

  /* ---------- 结构模板 ---------- */
  async function loadTemplates() {
    const j = await fetch("/api/templates").then((r) => r.json());
    document.getElementById("tplList").innerHTML = j.items.map((t) => `
      <div class="hit">
        <div class="hit-title"><span>${esc(t.name)}</span><span class="hit-score">${t.kind === "standard" ? window.t("hkStandard") : window.t("hkCustom")}</span></div>
        ${t.description ? `<div class="small dim">${esc(t.description)}</div>` : ""}
        <table class="table" style="margin-top:6px">
          <tr><th>节拍</th><th>占比</th><th>目标</th><th>钩子机制</th></tr>
          ${(t.beats || []).map((b) => `<tr><td>${esc(b.beat)}</td><td>${Math.round(b.ratio * 100)}%</td><td>${esc(b.goal || "-")}</td><td>${(b.hook_mechanism || []).map(esc).join("/") || "-"}</td></tr>`).join("")}
        </table>
        ${t.kind === "custom" ? `<div class="act-row"><button class="ghost sm" data-del="${esc(t.id)}" data-i18n="del">${window.t("del")}</button></div>` : ""}
      </div>`).join("");
    document.querySelectorAll("#tplList [data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        const j2 = await fetch(`/api/templates/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
        if (j2.ok) { window.toast(window.t("hkTplDeleted")); await loadTemplates(); }
        else window.toast(window.t("hkTplDelFail"), false);
      }));
  }

  async function createTemplate() {
    const name = document.getElementById("tplName").value.trim();
    const raw = document.getElementById("tplBeats").value.trim();
    if (!name || !raw) { window.toast(window.t("hkTplNeed"), false); return; }
    let beats;
    try { beats = JSON.parse(raw); }
    catch (e) { window.toast(window.t("hkTplJsonErr") + e.message, false); return; }
    const j = await fetch("/api/templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, beats, kind: "custom", description: "前台自定义创建" }),
    }).then((r) => r.json());
    window.toast(window.t("hkTplCreated"));
    document.getElementById("tplName").value = "";
    document.getElementById("tplBeats").value = "";
    await loadTemplates();
  }

  /* ---------- 小说转化 ---------- */
  const convLabels = {}; // idx -> label

  async function convert() {
    const title = document.getElementById("convTitle").value.trim();
    const text = document.getElementById("convText").value.trim();
    const mode = document.getElementById("convMode").value;
    if (!text) { window.toast(window.t("hkPasteNovel"), false); return; }
    const box = document.getElementById("convResult");
    box.innerHTML = `<p class="small dim">${window.t("hkConverting")}</p>`;
    const j = await fetch("/api/convert", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, text, mode }),
    }).then((r) => r.json());
    if (mode === "manual") { renderManual(j); return; }
    const c = j.converted || {};
    box.innerHTML = `
      <div class="hit"><b data-i18n="hkLoglineLabel">${window.t("hkLoglineLabel")}</b>${esc(c.logline || "-")}<br/>
      <span class="small dim">${window.t("hkClimaxStat", { i: j.analysis?.climax?.idx ?? "-", d: j.analysis?.dialogue_heavy ?? 0, h: j.hooks_saved })}</span></div>
      <table class="table"><tr><th>${window.t("hkThBeat")}</th><th>${window.t("hkThRatio")}</th><th>${window.t("hkThGoal")}</th></tr>
      ${(c.structure || []).map((b) => `<tr><td>${esc(b.beat)}</td><td>${b.ratio ? Math.round(b.ratio * 100) + "%" : "-"}</td><td>${esc(b.goal || "-")}</td></tr>`).join("")}</table>
      <h4>钩子设计</h4>
      ${(c.hooks || []).map((h) => `<div class="hit"><div class="hit-title"><span>${POS_CN[h.position] || h.position} · ${esc(h.mechanism)}</span><span class="hit-score">${window.t("hkIntensity")} ${h.intensity}</span></div><div class="small">${esc(h.text)}</div></div>`).join("")}
      <h4>爆点</h4><div class="hit-tags">${(c.burst_points || []).map((b) => `<span>${esc(b)}</span>`).join("") || "-"}</div>
      <h4>删减建议</h4><ul class="small dim">${(c.cut_suggestions || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <p class="small dim">${esc(c.episodes_hint || "")}</p>`;
  }

  function renderManual(j) {
    const box = document.getElementById("convResult");
    const paras = j.analysis?.paragraphs || [];
    box.innerHTML = `
      <p class="small dim">${window.t("hkParaStat", { n: j.analysis?.total_paragraphs ?? 0, i: j.analysis?.climax?.idx ?? "-" })}</p>
      ${paras.map((p) => `
        <div class="para-row ${p.climax_candidate ? "climax" : ""}">
          <div class="small"><b>#${p.idx}</b>${p.climax_candidate ? ` <span class="hit-score">${window.t("hkClimaxCand")}</span>` : ""}
          <span class="dim">${window.t("hkParaStats", { d: Math.round(p.dialogue_ratio * 100), t: p.turning_points, s: p.score })}</span></div>
          <div class="small">${esc(p.preview)}…</div>
          <div class="act-row">
            ${["钩子", "爆点", "反转", "删"].map((lb) =>
              `<button class="lbl-btn sm" data-idx="${p.idx}" data-lb="${lb}">${lb}</button>`).join("")}
          </div>
        </div>`).join("")}
      <div class="act-row"><button id="convSubmit" class="primary sm" data-i18n="hkSubmit">${window.t("hkSubmit")}</button></div>`;
    box.querySelectorAll(".lbl-btn").forEach((b) =>
      b.addEventListener("click", () => {
        const { idx, lb } = b.dataset;
        convLabels[idx] = convLabels[idx] === lb ? null : lb;
        box.querySelectorAll(`.lbl-btn[data-idx="${idx}"]`).forEach((x) => x.classList.remove("on"));
        if (convLabels[idx]) b.classList.add("on");
      }));
    box.querySelector("#convSubmit").addEventListener("click", async () => {
      const items = Object.entries(convLabels).filter(([, lb]) => lb && lb !== "删");
      if (!items.length) { window.toast(window.t("hkNoTags"), false); return; }
      let saved = 0;
      for (const [idx, lb] of items) {
        const p = paras.find((x) => String(x.idx) === idx);
        if (!p) continue;
        const mechMap = { "钩子": "悬念", "爆点": "反差", "反转": "反差" };
        try {
          await fetch("/api/hooks", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: `【标注】${j.title || "小说"}#${idx}`,
              text: p.preview, category: lb === "爆点" ? "反转钩" : "悬念钩",
              position: p.idx === 0 ? "open" : "mid", mechanism: mechMap[lb] || "悬念",
              intensity: 3, tags: ["人工标注", lb], status: "pending",
              market: window.duanjuMarket || "china",
            }),
          });
          saved++;
        } catch { /* 单条失败忽略 */ }
      }
      window.toast(window.t("hkSubmitted", { n: saved }));
      await loadHooks();
    });
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    // 状态过滤 tabs
    $$("#hookFilter .tab").forEach((t) =>
      t.addEventListener("click", () => {
        $$("#hookFilter .tab").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        curStatus = t.dataset.st;
        loadHooks();
      }));
    // 右侧功能 tabs
    $$("[data-htab]").forEach((t) =>
      t.addEventListener("click", () => {
        $$("[data-htab]").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        $$("[id^=htab-]").forEach((b) => b.classList.add("hidden"));
        document.getElementById("htab-" + t.dataset.htab).classList.remove("hidden");
        if (t.dataset.htab === "tpl") loadTemplates();
      }));
    document.getElementById("btnHookNew").addEventListener("click", () => openEditor(null));
    document.getElementById("btnHookExtract").addEventListener("click", extractText);
    document.getElementById("btnHookExtractAll").addEventListener("click", extractAll);
    document.getElementById("btnTplCreate").addEventListener("click", createTemplate);
    document.getElementById("btnConvert").addEventListener("click", convert);
    document.getElementById("btnRecipeDraw").addEventListener("click", drawRecipe);
  }

  return {
    activate() { if (!bind._done) { bind(); bind._done = true; } loadHooks(); },
  };
})();
