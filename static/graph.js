/* 知识图谱可视化引擎 — Canvas 力导向布局
   缩放 0.1-5.0 / 平滑拖拽 / 悬停预览 / 点击详情 / 一跳高亮 / 路径高亮 / 节点聚类 / 类型过滤 */
window.GraphView = (() => {
  const COLORS = {
    drama: "#3679b1", hook: "#af8545", trope: "#ad7278", theme: "#688eb4",
    emotion: "#8b80ac", style: "#4d9294", structure: "#8c9958",
  };
  let canvas, ctx, wrap, tip, panel;
  let nodes = [], links = [], idx = {}, adj = {};
  let scale = 1, ox = 0, oy = 0;
  let showTypes = new Set(Object.keys(COLORS));
  let hlNodes = new Set(), hlEdges = new Set();
  let alpha = 1, dragging = null, panning = false, panLast = null;
  let downPos = null, hoverId = null, selectedId = null;
  let raf = null, W = 0, H = 0, dpr = 1;
  let initialized = false, shown = false;
  const SETTLED_ALPHA = 0.015;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let _pendingSelect = null;  // 邻居跳转：目标被类型过滤排除时，跨 load 传递待选节点

  /* ---------- 初始化 ---------- */
  function init() {
    canvas = document.getElementById("graphCanvas");
    wrap = canvas.parentElement;
    tip = document.getElementById("graphTip");
    panel = document.getElementById("nodePanel");
    ctx = canvas.getContext("2d");
    fit();
    window.addEventListener("resize", () => { if (shown && !document.hidden) fit(); });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopFrames();
      else if (shown) { fit(); invalidate(); }
    });
    bindEvents();
    loadTypes();
    loadCluster();
  }

  function fit() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = wrap.clientWidth; H = wrap.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    invalidate();
  }

  function activate() {
    shown = true;
    if (!initialized) {
      initialized = true;
      init(); bindToolbar(); load(); loadStats(); loadArchiveList();
    } else fit();
    invalidate();
  }
  function onShown() { shown = true; fit(); }
  function onHidden() {
    shown = false;
    stopFrames();
    if (dragging) dragging.fixed = false;
    dragging = null; panning = false; downPos = null; hoverId = null;
    if (tip) hideTip();
  }

  /* ---------- 统计概览条（A1） ---------- */
  async function loadStats() {
    const box = document.getElementById("graphStats");
    try {
      const j = await fetch("/api/stats").then((r) => r.json());
      const g = j.graph || {};
      const t = g.last_extract_at ? String(g.last_extract_at).slice(0, 16).replace("T", " ") : "—";
      box.innerHTML = [
        `${window.t("gEnt")} <b>${g.entities ?? "-"}</b>`,
        `${window.t("gRel")} <b>${g.relations ?? "-"}</b>`,
        `${window.t("gPending")} <b class="${g.pending_review ? "warn" : ""}">${g.pending_review ?? "-"}</b>`,
        `${window.t("gAccuracy")} <b>${g.accuracy ?? "-"}%</b>`,
        `${window.t("gAvgConf")} <b>${g.avg_confidence ?? "-"}%</b>`,
        `${window.t("gLastExtract")} <b>${esc(t)}</b>`,
      ].map((s) => `<span class="stat-item">${s}</span>`).join("");
    } catch { box.innerHTML = ""; }
  }

  /* 视图平滑居中到指定节点（搜索定位 / 邻居跳转） */
  function centerOn(node, ts = 1.4) {
    scale = ts;
    ox = W / 2 - node.x * scale;
    oy = H / 2 - node.y * scale;
    document.getElementById("zoomChip").textContent = window.t("gZoom", { v: scale.toFixed(1) });
    invalidate();
  }

  /* ---------- 数据加载 ---------- */
  async function load() {
    const q = document.getElementById("graphSearch").value.trim();
    const types = [...showTypes].join(",");
    try {
      const j = await fetch(`/api/graph?types=${encodeURIComponent(types)}&q=${encodeURIComponent(q)}&limit=300&market=${encodeURIComponent(window.duanjuMarket || "china")}`).then((r) => r.json());
      applyData(j, q);
    } catch (e) {
      window.toast && window.toast(window.t("gLoadFail") + e.message, false);
    }
  }

  /* 渲染图谱数据（当前最新 /api/graph 与旧版归档 /api/kb/archive/{id} 同构共用） */
  function applyData(j, q) {
    const keepX = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    idx = {}; adj = {};
    const deg = {};
    j.links.forEach((l) => { deg[l.src] = (deg[l.src] || 0) + 1; deg[l.dst] = (deg[l.dst] || 0) + 1; });
    nodes = j.nodes.map((e) => {
      const old = keepX.get(e.id);
      const ang = Math.random() * Math.PI * 2, r0 = 40 + Math.random() * Math.min(W, H) * 0.3;
      return {
        id: e.id, type: e.type, name: e.name, props: e.props || {},
        category_ids: e.category_ids || [], review: e.review, confidence: e.confidence,
        deg: deg[e.id] || 0,
        x: old ? old.x : W / 2 + Math.cos(ang) * r0,
        y: old ? old.y : H / 2 + Math.sin(ang) * r0,
        vx: 0, vy: 0, fixed: false, r: 5 + Math.min(9, Math.sqrt(deg[e.id] || 0) * 1.8),
      };
    });
    nodes.forEach((n, i) => (idx[n.id] = i));
    links = j.links.filter((l) => l.src in idx && l.dst in idx);
    links.forEach((l) => {
      (adj[l.src] = adj[l.src] || []).push(l);
      (adj[l.dst] = adj[l.dst] || []).push(l);
    });
    document.getElementById("graphMeta").textContent = j.meta
      ? window.t("gArchiveMeta", { t: esc(String(j.meta.archived_at || "").slice(0, 16).replace("T", " ")), total: j.total, shown: j.shown, links: links.length })
      : window.t("gMeta", { total: j.total, shown: j.shown, links: links.length, ms: j.ms ?? "-" });
    alpha = 1;
    invalidate();
    // A3：类型过滤恢复后的定位选中（邻居跳转修复）
    if (_pendingSelect && idx[_pendingSelect] !== undefined) {
      const t = nodes[idx[_pendingSelect]];
      _pendingSelect = null;
      select(t);
      centerOn(t, 1.4);
      return;
    }
    // A2：搜索定位——命中节点全部高亮 + 首个命中平滑居中
    if (q && nodes.length) {
      hlNodes = new Set(nodes.map((n) => n.id));
      hlEdges.clear(); selectedId = null;
      centerOn(nodes[0], 1.4);
      renderPanelPlaceholder();
    } else {
      hlNodes.clear(); hlEdges.clear(); selectedId = null;
      renderPanelPlaceholder();
    }
  }

  async function loadTypes() {
    const box = document.getElementById("typeFilter");
    const j = await fetch("/api/graph?limit=1").then((r) => r.json());
    const names = j.type_names || {};
    Object.assign(TYPE_CN, names);
    box.innerHTML = Object.entries(names).map(([t, n]) =>
      `<label class="tf-item"><input type="checkbox" checked data-type="${t}"/>${esc(n)}</label>`).join("");
    box.querySelectorAll("input").forEach((c) =>
      c.addEventListener("change", () => {
        if (c.checked) showTypes.add(c.dataset.type); else showTypes.delete(c.dataset.type);
        load();
      }));
  }

  async function loadCluster() {
    const bar = document.getElementById("clusterBar");
    try {
      const j = await fetch(`/api/graph/cluster?market=${encodeURIComponent(window.duanjuMarket || "china")}`).then((r) => r.json());
      bar.innerHTML = `<span class="small dim">${window.t("navGraph")}：</span>` +
        `<button class="cl-chip active" data-t="" data-i18n="gAllTypes">${window.t("gAllTypes")}</button>` +
        j.clusters.map((c) =>
          `<button class="cl-chip" data-t="${c.type}" title="${window.t("gFilterTip")}">${COLORS[c.type] ? `<i style="background:${COLORS[c.type]}"></i>` : ""}${esc(c.name)} ${c.count}<span class="dim">${window.t("gAvgDeg", { v: c.avg_degree })}</span></button>`).join("");
      bar.querySelectorAll(".cl-chip").forEach((b) =>
        b.addEventListener("click", () => {
          bar.querySelectorAll(".cl-chip").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          const t = b.dataset.t;
          showTypes = t ? new Set([t]) : new Set(Object.keys(COLORS));
          const box = document.getElementById("typeFilter");
          box.querySelectorAll("input").forEach((c) => (c.checked = !t || c.dataset.type === t));
          load();
        }));
    } catch { bar.innerHTML = ""; }
  }

  /* ---------- 力导向模拟 ---------- */
  function tick() {
    const a = alpha;
    const n = nodes.length;
    // 斥力（两两）
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      for (let k = i + 1; k < n; k++) {
        const q = nodes[k];
        let dx = p.x - q.x, dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const f = Math.min(2200 / d2, 4) * a;
        const fx = (dx / Math.sqrt(d2)) * f, fy = (dy / Math.sqrt(d2)) * f;
        p.vx += fx; p.vy += fy; q.vx -= fx; q.vy -= fy;
      }
    }
    // 引力（弹簧）
    for (const l of links) {
      const p = nodes[idx[l.src]], q = nodes[idx[l.dst]];
      if (!p || !q) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = 60 + 40 / (l.weight || 1);
      const f = (d - rest) * 0.02 * a;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      p.vx += fx; p.vy += fy; q.vx -= fx; q.vy -= fy;
    }
    // 向心 + 积分
    for (const p of nodes) {
      p.vx -= (p.x - W / 2) * 0.004 * a;
      p.vy -= (p.y - H / 2) * 0.004 * a;
      if (p.fixed) { p.vx = p.vy = 0; continue; }
      p.vx *= 0.85; p.vy *= 0.85;
      p.x += Math.max(-30, Math.min(30, p.vx));
      p.y += Math.max(-30, Math.min(30, p.vy));
    }
    alpha *= 0.96;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    const hasHl = hlNodes.size > 0;
    // 边
    for (const l of links) {
      const p = nodes[idx[l.src]], q = nodes[idx[l.dst]];
      if (!p || !q) continue;
      const key1 = l.src + "|" + l.dst, key2 = l.dst + "|" + l.src;
      const hl = hlEdges.has(key1) || hlEdges.has(key2);
      ctx.strokeStyle = hl ? "rgba(45,112,168,0.9)" : "rgba(139,149,168,0.22)";
      ctx.lineWidth = hl ? 2 / scale : Math.min(2, 0.4 + (l.weight || 0.5)) / scale;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    // 节点
    for (const p of nodes) {
      const hl = hlNodes.has(p.id);
      ctx.globalAlpha = hasHl && !hl ? 0.18 : 1;
      if (hl || p.id === selectedId || p.id === hoverId) {
        ctx.shadowColor = COLORS[p.type] || "#fff";
        ctx.shadowBlur = 14 / scale;
      } else ctx.shadowBlur = 0;
      ctx.fillStyle = COLORS[p.type] || "#8b95a8";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      if (p.review === "pending") { // 待审核节点虚线圈
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = "rgba(159,119,54,0.8)";
        ctx.lineWidth = 1 / scale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 3 / scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      if (scale >= 0.45 || hl || p.id === selectedId || p.id === hoverId) {
        ctx.font = `${13 / scale}px "Hiragino Sans","Yu Gothic","PingFang SC",sans-serif`;
        ctx.textAlign = "center";
        ctx.lineJoin = "round"; // 白色描边打底，保证文字压在连线上也可读
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 3 / scale;
        ctx.strokeText(p.name.slice(0, 12), p.x, p.y + p.r + 12 / scale);
        ctx.fillStyle = "rgba(51,51,51,0.92)";
        ctx.fillText(p.name.slice(0, 12), p.x, p.y + p.r + 12 / scale);
      }
    }
    ctx.restore();
  }

  function stopFrames() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  }
  function invalidate() {
    if (shown && !document.hidden && raf === null) raf = requestAnimationFrame(renderFrame);
  }
  function renderFrame() {
    raf = null;
    if (!shown || document.hidden) return;
    if (alpha > SETTLED_ALPHA && nodes.length) {
      if (reducedMotion?.matches) {
        // Produce an initial arrangement without playing the simulation as an animation.
        for (let step = 0; step < 5; step++) tick();
        alpha = 0;
      } else tick();
    }
    draw();
    if (nodes.length && alpha > SETTLED_ALPHA) invalidate();
  }

  /* ---------- 坐标 / 命中 ---------- */
  const s2w = (mx, my) => ({ x: (mx - ox) / scale, y: (my - oy) / scale });
  function hit(mx, my) {
    const w = s2w(mx, my);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const p = nodes[i];
      const dx = w.x - p.x, dy = w.y - p.y;
      if (dx * dx + dy * dy <= (p.r + 4 / scale) ** 2) return p;
    }
    return null;
  }

  /* ---------- 交互 ---------- */
  function bindEvents() {
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const w = s2w(mx, my);
      const ns = Math.min(5, Math.max(0.1, scale * Math.exp(-e.deltaY * 0.0012)));
      ox = mx - w.x * ns; oy = my - w.y * ns;
      scale = ns;
      document.getElementById("zoomChip").textContent = window.t("gZoom", { v: scale.toFixed(1) });
      invalidate();
    }, { passive: false });

    canvas.addEventListener("mousedown", (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      downPos = { mx, my };
      const p = hit(mx, my);
      if (p) { dragging = p; p.fixed = true; alpha = Math.max(alpha, 0.4); }
      else { panning = true; panLast = { mx, my, ox, oy }; }
      invalidate();
    });

    window.addEventListener("mousemove", (e) => {
      if (!shown || document.hidden) return;
      if (e.target !== canvas && !dragging && !panning) {
        if (hoverId !== null) { hoverId = null; hideTip(); invalidate(); }
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      if (dragging) {
        const w = s2w(mx, my);
        dragging.x = w.x; dragging.y = w.y; dragging.vx = dragging.vy = 0;
        invalidate();
        return;
      }
      if (panning) { ox = panLast.ox + (mx - panLast.mx); oy = panLast.oy + (my - panLast.my); invalidate(); return; }
      if (e.target !== canvas) { hideTip(); hoverId = null; return; }
      const p = hit(mx, my);
      if (p) {
        canvas.style.cursor = "pointer";
        if (hoverId !== p.id) { hoverId = p.id; showTip(p, e.clientX, e.clientY); invalidate(); }
        else moveTip(e.clientX, e.clientY);
      } else {
        canvas.style.cursor = "default";
        if (hoverId !== null) { hideTip(); hoverId = null; invalidate(); }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (!shown || (!dragging && !panning)) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const moved = downPos && Math.hypot(mx - downPos.mx, my - downPos.my) > 4;
      if (dragging) {
        dragging.fixed = false;
        if (!moved) select(dragging);
        dragging = null;
      } else if (panning && !moved && e.target === canvas) {
        clearHl(); renderPanelPlaceholder();
      }
      panning = false;
      downPos = null;
      invalidate();
    });
  }

  /* ---------- 悬停预览 ---------- */
  function showTip(p, cx, cy) {
    const nbs = (adj[p.id] || []).slice(0, 3)
      .map((l) => nodes[idx[l.src === p.id ? l.dst : l.src]])
      .filter(Boolean);
    tip.innerHTML = `<b>${esc(p.name)}</b><br/>
      <span style="color:${COLORS[p.type]}">●</span> ${esc(TYPE_CN[p.type] || p.type)} · ${window.t("gDeg", { v: p.deg })} · ${window.t("gConf", { v: p.confidence ?? "-" })}<br/>
      <span class="dim">${nbs.length ? window.t("gNeighbors") + nbs.map((n) => esc(n.name.slice(0, 8))).join("、") : window.t("gNoNeighbors")}</span>`;
    tip.classList.remove("hidden");
    moveTip(cx, cy);
  }
  const moveTip = (cx, cy) => {
    tip.style.left = Math.min(cx + 14, window.innerWidth - 260) + "px";
    tip.style.top = Math.min(cy + 14, window.innerHeight - 100) + "px";
  };
  const hideTip = () => tip.classList.add("hidden");

  const TYPE_CN = {};

  /* ---------- 选中详情 ---------- */
  function clearHl() { hlNodes.clear(); hlEdges.clear(); selectedId = null; invalidate(); }

  async function select(p) {
    selectedId = p.id;
    panel.classList.remove("hidden");
    hlNodes = new Set([p.id]);
    hlEdges = new Set((adj[p.id] || []).map((l) => l.src + "|" + l.dst));
    invalidate();
    panel.innerHTML = `<p class="small dim">${window.t("loading")}</p>`;
    try {
      const j = await fetch(`/api/graph/node/${encodeURIComponent(p.id)}`).then((r) => r.json());
      const e = j.node, props = e.props || {};
      const chips = (arr) => (arr || []).map((t) => `<span>${esc(t)}</span>`).join("");
      const nbRows = (j.neighbors || []).map((n) => `
        <div class="nb-row">
          <span class="rel-tag">${n.dir === "out" ? "→" : "←"} ${esc(n.rel)}</span>
          <span class="nb-name" data-eid="${esc(n.node.id)}">${esc(n.node.name)}</span>
          <span class="small dim">w${n.weight}</span>
          <button class="ghost sm" data-path="${esc(n.node.id)}" title="${window.t("gPathTip")}">⤳</button>
        </div>`).join("");
      panel.innerHTML = `
        <div class="np-head">
          <span class="np-dot" style="background:${COLORS[e.type]}"></span>
          <b>${esc(e.name)}</b>
          <button class="modal-close np-close" id="npClose">✕</button>
        </div>
        <div class="np-meta small dim">${esc((j.type_names || TYPE_CN)[e.type] || e.type)} · ${esc(e.id)} · ${window.t("confidence")} ${e.confidence} · ${esc(e.review)}</div>
        <h4 data-i18n="nodeBrief">${window.t("nodeBrief")}</h4>
        <p class="small">${esc(props.brief || props.logline || props.desc || "—")}</p>
        <h4 data-i18n="nodeContent">${window.t("nodeContent")}</h4>
        <div class="np-text small">${esc(props.text || props.hook || props.reversal || props.line || "—")}</div>
        ${props.golden_lines && props.golden_lines.length ? `<h4 data-i18n="gGoldenLines">${window.t("gGoldenLines")}</h4><div class="small">${props.golden_lines.map(esc).join("<br/>")}</div>` : ""}
        <h4 data-i18n="nodeTags">${window.t("nodeTags")}</h4>
        <div class="hit-tags">${chips(props.tags)}${chips(e.category_ids)}</div>
        <h4>${window.t("nodeNeighbors")}（${(j.neighbors || []).length}）</h4>
        ${nbRows || `<p class="small dim">${window.t("none")}</p>`}`;
      panel.querySelector("#npClose").onclick = () => { clearHl(); renderPanelPlaceholder(); };
      panel.querySelectorAll(".nb-name").forEach((el) =>
        el.addEventListener("click", () => {
          const eid = el.dataset.eid;
          const t = nodes[idx[eid]];
          if (t) { select(t); centerOn(t, 1.6); return; }
          // A3 修复：目标不在当前 nodes（被类型过滤排除）→ 自动恢复该类型并跨 load 定位
          const nb = (j.neighbors || []).find((n) => n.node.id === eid);
          if (nb && nb.node.type && !showTypes.has(nb.node.type)) {
            _pendingSelect = eid;
            showTypes.add(nb.node.type);
            const box = document.getElementById("typeFilter");
            box.querySelectorAll("input").forEach((c) => {
              if (c.dataset.type === nb.node.type) c.checked = true;
            });
            window.toast && window.toast(window.t("gRestoredType", { t: TYPE_CN[nb.node.type] || nb.node.type }));
            load();
          }
        }));
      panel.querySelectorAll("[data-path]").forEach((el) =>
        el.addEventListener("click", () => highlightPath(p.id, el.dataset.path)));
    } catch (e) {
      panel.innerHTML = `<p class="small dim">${window.t("gDetailFail")}${esc(e.message)}</p>`;
    }
  }

  async function highlightPath(src, dst) {
    try {
      const p = await fetch(`/api/graph/path?src=${encodeURIComponent(src)}&dst=${encodeURIComponent(dst)}`).then((r) => r.json());
      hlNodes = new Set(p.nodes.map((n) => n.id));
      hlEdges = new Set(p.edges.map((e) => e.src + "|" + e.dst));
      selectedId = src;
      invalidate();
      window.toast && window.toast(window.t("gPathHighlight", { hops: p.hops, n: p.nodes.length }));
    } catch (e) {
      window.toast && window.toast(window.t("gNoPath") + e.message, false);
    }
  }

  function renderPanelPlaceholder() {
    panel.classList.add("hidden");
    panel.innerHTML = '<p class="small dim">点击节点查看详情：剧本实际内容 / 标准化简介 / 多级标签 / 关系邻居</p>';
  }

  /* ---------- 每日知识更新 + 旧版归档 ---------- */
  async function runDaily() {
    const btn = document.getElementById("btnKbDaily");
    btn.disabled = true; btn.textContent = window.t("gUpdating");
    try {
      const start = await fetch("/api/kb/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ use_llm: false, polish_limit: 0, extract_limit: 15 }),
      }).then((r) => r.json());
      if (!start.ok) {
        window.toast && window.toast(start.msg || window.t("gUpdateFail"), false);
        return;
      }
      window.toast && window.toast(window.t("gDailyStarted"));
      for (let i = 0; i < 150; i++) {
        await new Promise((res) => setTimeout(res, 4000));
        const st = await fetch("/api/kb/status").then((r) => r.json());
        if (!st.kb.running) {
          const rep = st.kb.last_report;
          if (rep) {
            window.toast && window.toast(
              window.t("gDailyDone", { ok: rep.collect_ok ? window.t("gYes") : window.t("gNo"), n: rep.extract_processed ?? "-", hooks: rep.hooks_new ?? "-", cards: rep.inspirations ?? "-" }));
          } else {
            window.toast && window.toast("更新完成");
          }
          break;
        }
      }
    } catch (e) {
      window.toast && window.toast("每日更新失败：" + e.message, false);
    } finally {
      btn.disabled = false; btn.textContent = "📅 每日更新";
    }
    await Promise.all([load(), loadStats(), loadCluster(), loadArchiveList()]);
  }

  async function loadArchiveList() {
    const sel = document.getElementById("graphArchive");
    try {
      const j = await fetch("/api/kb/archive").then((r) => r.json());
      const cur = sel.value;
      sel.innerHTML = `<option value="">${window.t("currentGraph")}</option>` + (j.items || []).map((m) =>
        `<option value="${esc(m.run_id)}">${esc(String(m.archived_at || "").slice(5, 16).replace("T", " "))} · ${m.entities}实体</option>`).join("");
      if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
    } catch { /* 归档列表加载失败不影响主视图 */ }
  }

  async function loadArchive(runId) {
    if (!runId) { load(); return; }
    try {
      const j = await fetch(`/api/kb/archive/${encodeURIComponent(runId)}?limit=300`).then((r) => r.json());
      applyData(j, "");
      window.toast && window.toast(`正在查看旧版归档：${String(j.meta?.archived_at || runId).slice(0, 16).replace("T", " ")}`);
    } catch (e) {
      window.toast && window.toast("归档加载失败：" + e.message, false);
    }
  }

  /* ---------- 工具栏事件 ---------- */
  function bindToolbar() {
    document.getElementById("btnGraphLoad").addEventListener("click", load);
    document.getElementById("graphSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
    document.getElementById("graphArchive").addEventListener("change", (e) => loadArchive(e.target.value));
    document.getElementById("btnKbDaily").addEventListener("click", runDaily);
    document.getElementById("btnGraphReset").addEventListener("click", () => {
      scale = 1; ox = 0; oy = 0; clearHl(); renderPanelPlaceholder();
      document.getElementById("zoomChip").textContent = "缩放 1.0x";
      window.toast && window.toast("视图已重置");
    });
    document.getElementById("btnGraphExtract").addEventListener("click", async () => {
      const btn = document.getElementById("btnGraphExtract");
      btn.disabled = true; btn.textContent = "抽取中…";
      try {
        const j = await fetch("/api/graph/extract", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 8, use_llm: false }),
        }).then((r) => r.json());
        const s = j.stats || j;
        window.toast && window.toast(`抽取完成：处理 ${s.processed ?? "-"} 条 → 实体 ${s.entities ?? "-"} / 关系 ${s.relations ?? "-"} / 钩子 ${s.hooks_new ?? "-"}`);
        await load(); await loadCluster(); await loadStats();
      } catch (e) {
        window.toast && window.toast("抽取失败：" + e.message, false);
      } finally {
        btn.disabled = false; btn.textContent = "⚡ 知识抽取";
      }
    });
  }

  /* 暴露 */
  return {
    activate,
    onShown,
    onHidden,
    load,
  };
})();
