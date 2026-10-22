/* 资源库中心：剧本库 + 灵感库 列表展示与文件批量导入（拖拽/多选，仿知识导入页面交互） */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  let bound = false;
  let target = "script";          // 当前导入目标：script | inspiration
  let libTab = "script";          // 当前浏览的库：script | inspiration
  let kindFilter = "";            // 剧本库筛选："" 全部 | reference 参考剧本库 | generated 生成剧本库
  let selectedFiles = [];         // 待导入文件
  let scripts = [];               // 剧本库
  let sparks = [];                // 灵感库

  const fmtSize = (b) => (b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB");
  const LOCALE_TAG = { "zh-CN": "zh-CN", "en": "en-US", "ja-JP": "ja-JP" };
  const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString(LOCALE_TAG[window.duanjuLocale] || "zh-CN", { hour12: false }) : "—");

  /* ---------- 绑定（一次性） ---------- */
  function bind() {
    if (bound) return;
    bound = true;

    // 导入目标切换
    $$("#hubTargetTabs .tab").forEach((b) => b.addEventListener("click", () => {
      target = b.dataset.target;
      $$("#hubTargetTabs .tab").forEach((x) => x.classList.toggle("active", x === b));
      $("#hubDzHint").dataset.i18n = target === "script" ? "dzHintScript" : "dzHintInsp";
      $("#hubDzHint").textContent = window.t(target === "script" ? "dzHintScript" : "dzHintInsp");
      // 目标切换时自动切到对应库浏览
      setLibTab(target === "script" ? "script" : "inspiration");
    }));

    // 拖拽 + 点击选择
    const dz = $("#hubDropZone");
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
      addFiles(e.dataTransfer.files);
    });
    dz.addEventListener("click", () => $("#hubFileInput").click());
    $("#hubFileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });

    // 导入
    $("#btnHubImport").addEventListener("click", doImport);

    // 库浏览 tab 切换 + 搜索 + kind 筛选 + 刷新
    $$("section.panel.center [data-libtab]").forEach((b) => b.addEventListener("click", () => setLibTab(b.dataset.libtab)));
    $("#hubSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") renderLists(); });
    $("#hubSearch").addEventListener("input", renderLists);
    // 言語ボタン：界面语言循环切换（市场由站点 URL 决定）
    $("#hubLangBtn")?.addEventListener("click", () => {
      const order = ["zh-CN", "ja-JP", "en"];
      const next = order[(order.indexOf(window.duanjuLocale) + 1) % order.length];
      window.setDuanjuLocale?.(next);
    });
    $("#hubContentType")?.addEventListener("change", renderLists);
    $("#hubLocale")?.addEventListener("change", renderLists);
    $("#hubSource")?.addEventListener("change", renderLists);
    $$("#hubKindTabs .tab").forEach((b) => b.addEventListener("click", () => {
      kindFilter = b.dataset.kind;
      $$("#hubKindTabs .tab").forEach((x) => x.classList.toggle("active", x === b));
      renderLists();
    }));
    $("#btnHubRefresh").addEventListener("click", loadLibs);
  }

  /* ---------- 文件选择 ---------- */
  function addFiles(fileList) {
    const accept = target === "script" ? ["txt", "md", "markdown", "csv"] : ["json", "md", "markdown", "txt", "csv"];
    for (const f of fileList) {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (accept.includes(ext)) selectedFiles.push(f);
    }
    renderFileList();
  }

  function renderFileList() {
    const list = $("#hubFileList");
    list.innerHTML = selectedFiles.map((f, i) => `
      <div class="file-item">
        <span class="f-name">${esc(f.name)}</span>
        <span class="f-size">${fmtSize(f.size)}</span>
        <span class="f-remove" data-i="${i}" title="${window.t("remove")}">✕</span>
      </div>`).join("");
    list.querySelectorAll(".f-remove").forEach((x) => x.addEventListener("click", () => {
      selectedFiles.splice(+x.dataset.i, 1);
      renderFileList();
    }));
    $("#btnHubImport").disabled = selectedFiles.length === 0;
    $("#btnHubImport").textContent = selectedFiles.length
      ? window.t("importBtnN", { n: selectedFiles.length, dest: window.t(target === "script" ? "libScript" : "libInsp") })
      : window.t("startImport");
  }

  /* ---------- 执行导入 ---------- */
  async function doImport() {
    if (!selectedFiles.length) return;
    const btn = $("#btnHubImport");
    btn.disabled = true;
    btn.textContent = window.t("importing");
    const out = $("#hubImportResult");
    out.innerHTML = `<p class="small dim">${window.t("uploading")}</p>`;
    try {
      const fd = new FormData();
      selectedFiles.forEach((f) => fd.append("files", f));
      fd.append("target", target);
      fd.append("market", (window.duanjuMarket === "global" ? "" : window.duanjuMarket) || "china");
      fd.append("content_type", $("#hubContentType")?.value || (target === "inspiration" ? "inspiration" : "short_drama"));
      fd.append("locale", window.duanjuOutputLocale || (window.duanjuMarket === "japan" ? "ja-JP" : "zh-CN"));
      const r = await fetch("/api/hub/import", { method: "POST", body: fd });
      const j = await r.json();
      const lines = (j.results || []).map((x) => `
        <div class="hub-import-line ${x.ok ? "ok" : "err"}">
          <span>${x.ok ? "✓" : "✗"}</span><span>${esc(x.file)}</span>
          <span style="flex:1">${esc(x.ok ? x.message || window.t("doneMsg") : x.error || window.t("fail"))}</span>
        </div>`).join("");
      out.innerHTML = lines || `<p class="small dim">${window.t("noResult")}</p>`;
      const okN = (j.results || []).filter((x) => x.ok).length;
      toast(window.t("importDone", { ok: okN, total: j.results?.length || 0 }), okN === (j.results || []).length);
      selectedFiles = [];
      renderFileList();
      await loadLibs();
      setLibTab(target === "script" ? "script" : "inspiration");
    } catch (e) {
      out.innerHTML = `<div class="hub-import-line err"><span>✗</span><span>${window.t("uploadFail")}</span><span style="flex:1">${esc(e.message)}</span></div>`;
      btn.disabled = false;
      renderFileList();
    }
  }

  /* ---------- 库数据加载 ---------- */
  async function loadLibs() {
    try {
      const [libJ, inspJ] = await Promise.all([
        fetch(`/api/library?market=${encodeURIComponent(window.duanjuMarket || "china")}`).then((r) => r.json()),
        fetch(`/api/inspirations?market=${encodeURIComponent(window.duanjuMarket || "china")}`).then((r) => r.json()),
      ]);
      scripts = libJ.list || [];
      sparks = inspJ.cards || [];
      $("#hubScriptCount").textContent = `(${scripts.length})`;
      $("#hubInspCount").textContent = `(${sparks.length})`;
      renderLists();
    } catch (e) {
      toast(window.t("libLoaded") + "：" + e.message, false);
    }
  }

  function setLibTab(t) {
    libTab = t;
    $$("section.panel.center [data-libtab]").forEach((b) => b.classList.toggle("active", b.dataset.libtab === t));
    $("#hubLibList").classList.toggle("hidden", t !== "script");
    $("#hubInspList").classList.toggle("hidden", t !== "inspiration");
    renderLists();
  }

  function kw() { return $("#hubSearch").value.trim().toLowerCase(); }

  /* 来源筛选：hongguo=红果/实时采集，jjwxc=晋江，jp=日本源(jp_*)，manual=手动导入 */
  function matchSource(item, source) {
    const src = String(item.source || item.source_platform || item.platform || "").toLowerCase();
    const st = String(item.source_type || "").toLowerCase();
    if (source === "manual") return st === "manual" || src.includes("导入") || src.includes("manual");
    if (source === "hongguo") return src.includes("hongguo") || src.includes("红果");
    if (source === "jjwxc") return src.includes("jjwxc") || src.includes("晋江");
    if (source === "jp") return src.startsWith("jp_") || src.includes("japan") || /^(bump|fod|dramabox|line|book|kakuyomu|narou|syosetu|renta)/.test(src);
    return true;
  }

  function renderLists() {
    const q = kw();
    const market = window.duanjuMarket || "china";  // 站点市场固定
    const contentType = $("#hubContentType")?.value || "";
    const locale = $("#hubLocale")?.value || "";
    const source = $("#hubSource")?.value || "";
    renderScriptList(scripts.filter((s) =>
      (!kindFilter || (s.kind || "reference") === kindFilter) &&
      (!market || (s.market || "china") === market) &&
      (!contentType || (s.content_type || "short_drama") === contentType) &&
      (!locale || (s.locale || s.output_locale || "zh-CN").startsWith(locale)) &&
      (!source || matchSource(s, source)) &&
      (!q || JSON.stringify([s.title, s.genre, s.hero, s.hot_tags, s.outline]).toLowerCase().includes(q))
    ));
    renderInspList(sparks.filter((c) => (!market || (c.market || "china") === market) &&
      (!contentType || (c.content_type || "short_drama") === contentType) &&
      (!locale || (c.locale || "zh-CN").startsWith(locale)) &&
      (!source || matchSource(c, source)) &&
      (!q || JSON.stringify([c.title, c.genre, c.tags, c.logline, c.author]).toLowerCase().includes(q))));
  }

  document.addEventListener("duanju:locale", () => { syncControls(); renderLists(); });

  /* 同步语言按钮文案 */
  function syncControls() {
    $("#hubSource")?.querySelectorAll("option").forEach((option) => {
      const unavailable = window.duanjuMarket === "japan" && ["hongguo", "jjwxc"].includes(option.value);
      option.hidden = unavailable;
      option.disabled = unavailable;
      if (unavailable && option.selected) $("#hubSource").value = "";
    });
    const lang = $("#hubLangBtn");
    if (lang) lang.textContent = "🌐 " + (window.duanjuLocale === "ja-JP" ? "日本語" : window.duanjuLocale === "en" ? "English" : "中文");
  }

  /* ---------- 剧本库列表 ---------- */
  const kindBadge = (s) => {
    if ((s.kind || "reference") === "generated") return window.t("badgeGenerated");
    if (s.record_type === "source_reference") return window.t("sourceReference");
    if (s.source_id) return window.t("badgeGraph");
    return window.t("badgeReference");
  };
  function renderScriptList(list) {
    const box = $("#hubLibList");
    if (!list.length) {
      box.innerHTML = `<p class="small dim" style="padding:14px 4px">${kw()
        ? window.t("emptyNoMatch")
        : kindFilter === "generated"
          ? window.t("emptyScriptGen")
          : kindFilter === "reference"
            ? window.t("emptyScriptRef")
            : window.t("emptyScriptAll")}</p>`;
      return;
    }
    box.innerHTML = list.map((s) => `
      <div class="hub-item" data-id="${esc(s.id)}">
        <div class="hub-item-head">
          <span class="hub-badge">${kindBadge(s)}</span>
          <span class="hub-item-title">《${esc(s.title)}》</span>
          <span class="hub-item-meta">${esc(s.genre || "—")}${s.hero ? " · " + window.t("itemHero") + " " + esc(s.hero) : ""}${s.source ? " · " + window.t("itemSource") + " " + esc(s.source) : ""} · ${s.record_type === "source_reference" ? window.t("sourceReference") : (s.script || "").length + window.t("itemChars")} · ${window.t("itemUpdated")} ${fmtTime(s.updated_at)}</span>
          <span class="hub-item-actions">
            <button class="ghost sm hub-view" data-id="${esc(s.id)}" data-i18n="view">${window.t("view")}</button>
            <button class="primary sm hub-cont" data-id="${esc(s.id)}" data-i18n="toWriter">${window.t(s.record_type === "source_reference" ? "useReference" : "toWriter")}</button>
            ${s.read_only ? "" : `<button class="ghost sm hub-del" data-id="${esc(s.id)}" data-i18n="del">${window.t("del")}</button>`}
          </span>
        </div>
        ${s.outline ? `<div class="hub-item-body"><div class="hub-outline">${esc(s.outline)}</div></div>`
                    : `<div class="hub-item-body"><div class="hub-outline">${esc((s.script || "").slice(0, 120))}…</div></div>`}
        ${(s.hot_tags || []).length ? `<div class="hit-tags">${s.hot_tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
      </div>`).join("");
    bindScriptActions(box);
  }

  function bindScriptActions(box) {
    box.querySelectorAll(".hub-view").forEach((b) => b.addEventListener("click", async () => {
      try {
        const r = await fetch(`/api/library/${encodeURIComponent(b.dataset.id)}`);
        if (!r.ok) throw new Error(window.t("loadFail"));
        const item = await r.json();
        showModalView(item);
      } catch (e) { toast(window.t("loadFail") + "：" + e.message, false); }
    }));
    box.querySelectorAll(".hub-cont").forEach((b) => b.addEventListener("click", () => {
      switchView("writer");
      if (window.WriterView?.openContinueFromLibrary) window.WriterView.openContinueFromLibrary(b.dataset.id);
    }));
    box.querySelectorAll(".hub-del").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(window.t("confirmDelScript"))) return;
      try {
        const r = await fetch(`/api/library/${encodeURIComponent(b.dataset.id)}`, { method: "DELETE" });
        if (!r.ok) throw new Error(window.t("delFail"));
        toast(window.t("deleted"));
        loadLibs();
      } catch (e) { toast(window.t("delFail") + "：" + e.message, false); }
    }));
  }

  function showModalView(item) {
    if (item.record_type === "source_reference") {
      const url = /^https?:\/\//i.test(item.source_url || "") ? item.source_url : "";
      showModal(`${window.t("sourceReference")} · ${item.title}`, `
        <p class="small dim">${window.t("referenceNotice")}</p>
        <p>${esc(item.source || "")}${item.author ? " · " + esc(item.author) : ""}</p>
        <h3>${window.t("synopsisTitle")}</h3><div>${fmtText(item.outline || window.t("noBody"))}</div>
        ${item.excerpt ? `<h3>${window.t("excerptTitle")}</h3><div>${fmtText(item.excerpt)}</div>` : ""}
        ${!item.read_only && item.script ? `<div>${fmtText(item.script)}</div>` : ""}
        ${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${window.t("openSource")}</a></p>` : ""}`);
      return;
    }
    showModal(`${window.t("scriptModal")} · ${item.title}`, `
      <div style="margin-bottom:10px;line-height:1.9">
        <span class="hub-badge">${esc(item.genre || "—")}</span>
        ${item.hero ? `<span class="small dim" style="margin-left:8px">${window.t("itemHero")}：${esc(item.hero)}</span>` : ""}
        ${(item.hot_tags || []).length ? `<div class="hit-tags" style="margin-top:6px">${item.hot_tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
      </div>
      ${item.outline ? `<h3 style="margin-bottom:6px" data-i18n="outlineTitle">${window.t("outlineTitle")}</h3><div style="font-size:12.5px;line-height:1.7;margin-bottom:12px">${fmtText(item.outline)}</div>` : ""}
      <h3 style="margin-bottom:6px" data-i18n="scriptBody">${window.t("scriptBody")}</h3>
      <div style="font-size:12.5px;line-height:1.75;max-height:52vh;overflow-y:auto;background:var(--panel2);border-radius:8px;padding:12px">${fmtText(item.script || window.t("noBody"))}</div>`);
  }

  /* ---------- 灵感库列表 ---------- */
  function renderInspList(list) {
    const box = $("#hubInspList");
    if (!list.length) {
      box.innerHTML = `<p class="small dim" style="padding:14px 4px">${kw() ? window.t("emptyNoMatch") : window.t("emptyInsp")}</p>`;
      return;
    }
    box.innerHTML = list.map((c) => `
      <div class="hub-item">
        <div class="hub-item-head">
          ${String(c.id || "").startsWith("user-") ? `<span class="hub-badge">${window.t("badgeImport")}</span>` : `<span class="hub-badge">${window.t("badgeKbInsp")}</span>`}
          <span class="hub-item-title">${esc(c.title)}</span>
          <span class="hub-item-meta">${esc(c.genre || "—")}${c.author ? " · " + esc(c.author) : ""} · ${window.t("heat")} ${c.heat ?? 0}</span>
          <span class="hub-item-actions">
            <button class="primary sm hub-use" data-id="${esc(c.id)}" data-i18n="useStudio">${window.t("useStudio")}</button>
          </span>
        </div>
        <div class="hub-item-body">
          <div class="hub-outline">${esc(c.logline || "—")}</div>
          ${c.open_hook?.text ? `<div style="margin-top:4px"><b>${window.t("openHook")}：</b>${esc(c.open_hook.text)} <span class="badge">${esc(c.open_hook.from || window.t("badgeImport"))}${c.open_hook.mechanism ? " · " + esc(c.open_hook.mechanism) : ""}</span></div>` : ""}
        </div>
        ${(c.tags || []).length ? `<div class="hit-tags">${c.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
      </div>`).join("");
    box.querySelectorAll(".hub-use").forEach((b) => b.addEventListener("click", () => {
      const card = sparks.find((x) => x.id === b.dataset.id);
      if (card) fillStudio(card);
    }));
  }

  /* ---------- 入口 ---------- */
  async function activate() {
    bind();
    syncControls();
    await loadLibs();
  }

  window.HubView = { activate };

  /* Load on first library visit. Creation is the default view. */
})();
