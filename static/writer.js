/* Trae 对接 · AI 编剧（两段式：申请调用 → 生成前半部分 → 满意度确认 → 续写后续 / 导入续写）
   复用 app.js 全局工具：$ / $$ / esc / fmtText / NODE_DEFS / toast */
window.WriterView = (() => {
  let bound = false;
  let tid = null;
  let timer = null;
  let rendered = 0; // 已渲染事件数（增量渲染）
  let stageSeen = "";

  /* 导入示例：《工地捡玉后，全城大佬连夜求我》（作品集格式） */
  const SAMPLE = [
    "## 01 《工地捡玉后，全城大佬连夜求我》",
    "",
    "- **题材**：逆袭/战神 · 24 集 × 2 分钟",
    "- **一句话故事**：工地钢筋工捡到一块古玉，从此听得懂万物说话——墙里的钢筋、地下的水管、老板口袋里的手机，全成了他的眼线。",
    "- **人物**：",
    "  - **陈铁柱**，32 岁，钢筋工。手糙话少，护短。五年没回家，攒钱给妹妹交学费。",
    "  - **赵世豪**，45 岁，世豪地产老板。见人三分笑，刀子藏在合同里。",
    "",
    "### 第 1 集",
    "",
    "**场1 日/外 · 工地基坑**",
    "",
    "塔吊阴影下，陈铁柱蹲在土堆边扒饭。手机屏幕碎了花，锁屏是妹妹的学费缴费单截图。",
    "",
    "> 工头（远处喊）：铁柱！三号坑清出来，今晚之前！",
    "",
    "陈铁柱把最后一口饭塞进嘴里，抹把嘴下了坑。铁锹磕到硬物，当的一声。他扒开土——一块巴掌大的黑玉，入手温得像揣了半天的鸡蛋。",
    "",
    "> 手机（突然开口，电子音里混着人腔）：温的？你赚了，这是汉代的。",
    "",
    "陈铁柱手一抖，手机飞出去。他环顾四周——工友都在几十米外。",
    "",
    "> 陈铁柱（盯着玉，声音发干）：……刚才是谁说话？",
    "> 古玉（懒洋洋）：我。",
    "",
    "**场2 日/外 · 工地办公室外**",
    "",
    "陈铁柱揣着玉去找工头结工钱，隔着铁皮墙，听见里面两个人压着嗓子。",
    "",
    "> 工头：这条管线的验收报告是假的。真管子偷工减料，浇筑完谁也看不出来。",
    "> 会计：楼上监理那边——",
    "> 工头：塞两千红包就行。这工地一年沉三个亿，谁盯着这几根管子？",
    "",
    "铁皮墙里，锈水管嗡了一声（古玉传音）：说得跟真的一样，我都锈穿了。",
    "",
    "陈铁柱捏紧口袋里的玉，转身走开。走出十几步，掏出手机对着自己，按下了录音。",
    "",
    "**场3 日/外 · 项目部会议室**",
    "",
    "赵世豪陪市里检查组走基坑，皮鞋锃亮，绕着泥点走。",
    "",
    "> 陈铁柱（在人群外喊）：赵总！三号线验收前，建议您抽干水看一眼管壁。",
    "> 赵世豪（笑）：小同志，你懂管子，还是懂我？",
    "> 陈铁柱：我懂管子。它说它想见您。",
    "",
    "全场哄笑。检查组里一个戴眼镜的却停下了脚。赵世豪笑容不变，眼神沉下去，对身边人低语——",
    "",
    "> 赵世豪：查他。今晚之前。",
    "",
    "**尾钩**：当晚，陈铁柱的出租屋门被敲响。猫眼外，站着白天那个戴眼镜的检查员。",
    "",
    "> 检查员（门外，声音很轻）：陈师傅。那块玉，是三十年前从我家坟里挖出来的。",
    "",
    "### 后续走向（2–6 集）",
    "检查员亮明身份（文物局内线 / 守玉人后代），古玉认主规则揭晓；赵世豪先收买后毁约，工地事故当晚被古玉提前预警，陈铁柱救人反被诬陷；第 6 集结尾，妹妹的学费到账，打款人栏写着——赵世豪。",
  ].join("\n");

  /* ---------- 剧本库自主维护 ---------- */
  let library = [];
  let currentLibId = null;
  let history = []; // 历史任务列表
  let libFilter = ""; // 库筛选："" 全部 | generated 生成剧本库 | reference 参考剧本库
  
  async function loadLibrary() {
    try {
      const r = await fetch(`/api/library?market=${encodeURIComponent(window.duanjuMarket || "china")}`);
      const j = await r.json();
      if (j.ok) {
        library = j.list;
        renderLibrary();
        toast(window.t("wLib") + ` · ${j.count}`, true);
      } else {
        toast(window.t("wLibFail"), false);
      }
    } catch (e) {
      toast(window.t("wLibFail") + "：" + e.message, false);
    }
  }
  
  const libKindBadge = (item) => {
    if ((item.kind || "reference") === "generated") return window.t("badgeGenerated");
    if (item.record_type === "source_reference") return window.t("sourceReference");
    if (item.source_id) return window.t("badgeGraph");
    return window.t("badgeReference");
  };

  function renderLibrary() {
    const container = $("#libraryList");
    if (!container) return;
    const list = library.filter((item) => !libFilter || (item.kind || "reference") === libFilter);
    if (list.length === 0) {
      container.innerHTML = `<div class="empty">${libFilter === "generated"
        ? window.t("wLibEmptyGen")
        : libFilter === "reference"
          ? window.t("wLibEmptyRef")
          : window.t("wLibEmpty")}</div>`;
      return;
    }
    container.innerHTML = list.map(item => `
      <div class="library-item" data-id="${item.id}" style="padding:8px;border-bottom:1px solid #eee;cursor:pointer;">
        <div><span class="hub-badge">${libKindBadge(item)}</span> <strong>${esc(item.title)}</strong></div>
        <div class="small dim">${window.t("wLblGenre")}：${esc(item.genre)} · ${window.t("wLblHot")}：${esc((item.hot_tags || []).join(", "))}</div>
        <div class="small dim">${window.t("itemUpdated")}：${new Date(item.updated_at * 1000).toLocaleString()}</div>
        <button class="sm secondary load-lib-btn" data-id="${item.id}" style="float:right;margin-top:-20px;" data-i18n="wLoadBtn">${window.t("wLoadBtn")}</button>
        <button class="sm secondary cont-lib-btn" data-id="${item.id}" style="float:right;margin-top:-20px;margin-right:8px;" >${window.t(item.record_type === "source_reference" ? "useReference" : "wContinue")}</button>
        ${item.read_only ? "" : `<button class="sm delete-lib-btn" data-id="${item.id}" style="float:right;margin-top:-20px;margin-right:8px;" data-i18n="del">${window.t("del")}</button>`}
      </div>
    `).join("");
    // 绑定加载和删除按钮
    $$(".load-lib-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const lid = e.target.dataset.id;
        await loadLibraryItem(lid);
      });
    });
    $$(".cont-lib-btn").forEach(btn => {
      btn.addEventListener("click", (e) => continueFromLibrary(e.target.dataset.id));
    });
    $$(".delete-lib-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const lid = e.target.dataset.id;
        if (confirm(window.t("delLibConfirm"))) {
          await deleteLibraryItem(lid);
          await loadLibrary();
        }
      });
    });
  }
  
  async function loadLibraryItem(lid) {
    try {
      const r = await fetch(`/api/library/${encodeURIComponent(lid)}`);
      if (!r.ok) throw new Error(window.t("loadFail"));
      const item = await r.json();
      currentLibId = item.read_only ? null : lid;
      window.WorkspaceUI?.closeDrawer(true);
      // 把剧本数据填充到生成表单
      $("#wIdea").value = item.title;
      $("#wGenre").value = item.genre;
      $("#wHero").value = item.hero;
      $("#wHotTags").value = (item.hot_tags || []).join(", ");
      // 可以自动填充导入框内容
      $("#wImport").value = item.record_type === "source_reference"
        ? [`## 《${item.title}》`, `- **题材**：${item.genre || ""}`, `- **一句话故事**：${item.outline || item.title}`, ...(item.hero ? [`- **主角**：${item.hero}`] : []), "### 剧情资料（参考资料，非正文）", item.excerpt || item.outline || ""].join("\n\n")
        : item.script || "";
      toast(item.source === "知识图谱"
        ? window.t("wLoadedCard", { title: item.title })
        : window.t("wLoadedScript", { title: item.title }), true);
    } catch (e) {
      toast(window.t("loadFail") + "：" + e.message, false);
    }
  }
  
  async function deleteLibraryItem(lid) {
    try {
      const r = await fetch(`/api/library/${lid}`, { method: "DELETE" });
      const j = await r.json();
      if (j.ok) {
        return true;
      } else {
        toast(window.t("delFail"), false);
        return false;
      }
    } catch (e) {
      toast(window.t("delFail") + "：" + e.message, false);
      return false;
    }
  }
  
  async function importToLibrary() {
    const text = $("#wImport").value.trim();
    if (!text) return toast(window.t("wImportNeed"), false);
    try {
      const r = await fetch("/api/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, market: window.duanjuMarket || "china", locale: $("#wLocale")?.value || (window.duanjuMarket === "japan" ? "ja-JP" : "zh-CN"), content_type: $("#wContentType")?.value || "short_drama" })
      });
      const j = await r.json();
      if (j.ok) {
        await loadLibrary();
        toast(window.t("wImported", { title: j.title, tags: (j.hot_tags || []).join(", ") }), true);
        currentLibId = j.id;
      } else {
        toast(window.t("wImportFail") + "：" + (j.detail || ""), false);
      }
    } catch (e) {
      toast(window.t("wImportFail") + "：" + e.message, false);
    }
  }
  
  /* ---------- ① 申请 Trae 调用 ---------- */
  async function traeConnect() {
    const el = $("#traeStatus");
    el.removeAttribute("data-i18n");
    el.textContent = window.t("wConnecting");
    try {
      const r = await fetch("/api/writer/status");
      const j = await r.json();
      if (j.connected) {
        el.innerHTML = `✅ ${window.t("wConnected")} · ${esc(j.model)}<br /><span class="dim">${esc(j.engine)}</span>`;
        $("#wChip").textContent = window.t("wEngineOn") + (j.model || "");
        $("#wChip").classList.add("on");
        $("#writerForm").classList.remove("hidden");
        toast(window.t("wEngineReady"), true);
      } else {
        el.textContent = "❌ " + window.t("wNoKey");
        toast(window.t("wNoKeyToast"), false);
      }
    } catch (e) {
      el.textContent = "❌ " + window.t("wConnFail") + "：" + e.message;
      toast(window.t("wConnFail") + "：" + e.message, false);
    }
  }

  /* ---------- ② 生成前半部分（新增热点标签支持） ---------- */
  async function genFirstHalf() {
    const idea = $("#wIdea").value.trim();
    const hot_tags = $("#wHotTags").value.trim().split(/[,，、]/).map(t => t.trim()).filter(t => t);
    if (!idea) return toast(window.t("wNeedIdea"), false);
    resetCanvas(window.t("wStage1Running"));
    $("#wChip").textContent = window.t("wStage1Chip");
    try {
      const r = await fetch("/api/writer/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea,
          genre: $("#wGenre").value,
          hero: $("#wHero").value.trim(),
          episodes: +$("#wTarget").value || 10,
          first_half: +$("#wHalf").value || 5,
          hot_tags,  // 热点标签传递给后端
          market: window.duanjuMarket || "china",
          output_locale: $("#wLocale")?.value || (window.duanjuMarket === "japan" ? "ja-JP" : "zh-CN"),
          content_type: $("#wContentType")?.value || "short_drama",
        }),
      });
      const j = await r.json();
      if (!j.ok) return toast(window.t("wSubmitFail"), false);
      tid = j.tid;
      startPoll();
      toast(window.t("wSubmitted"), true);
    } catch (e) {
      toast(window.t("wSubmitFail") + "：" + e.message, false);
    }
  }

  /* ---------- 激活绑定（首次进入视图） ---------- */
  function activate() {
    if (bound) return;
    bound = true;
    $("#wChip").removeAttribute("data-i18n");
    $("#btnTraeConn").addEventListener("click", traeConnect);
    $("#btnWriterGen").addEventListener("click", genFirstHalf);
    $("#btnWriterImport").addEventListener("click", () => {
      if (!$("#wImport").value.trim()) {
        window.WorkspaceUI?.openDrawer("writerResources", $("#btnWriterImport"));
        $("#wImport").focus();
        return;
      }
      importContent();
    });
    $("#btnImportSample").addEventListener("click", () => {
      $("#wImport").value = window.duanjuMarket === "japan" ? window.t("scriptSample") : SAMPLE;
      toast(window.t("wSampleFilled"), true);
    });
    $("#btnLibraryRefresh").addEventListener("click", loadLibrary);
    $("#btnLibraryImport").addEventListener("click", importToLibrary);
    $("#btnWriterImportSheet").addEventListener("click", importContent);
    $$("#writerKindTabs .tab").forEach((b) => b.addEventListener("click", () => {
      libFilter = b.dataset.kind;
      $$("#writerKindTabs .tab").forEach((x) => x.classList.toggle("active", x === b));
      renderLibrary();
    }));
    /* 拆站后市场由站点 URL 固定（window.duanjuMarket），不再提供页面内切换 */
    if ($("#wLocale")) $("#wLocale").value = window.duanjuOutputLocale || window.duanjuLocale || "zh-CN";
    if ($("#wContentType")) $("#wContentType").value = window.duanjuContentType || "short_drama";
    $("#wTarget").addEventListener("input", (e) => ($("#wTargetVal").textContent = e.target.value));
    $("#wHalf").addEventListener("input", (e) => ($("#wHalfVal").textContent = e.target.value));
    $("#btnWriterContinue").addEventListener("click", continueGen);
    $("#btnHistRefresh").addEventListener("click", loadHistory);
    // 页面加载时自动加载剧本库与历史任务
    loadLibrary();
    loadHistory();
  }

  /* ---------- 画布节点渲染（增量） ---------- */
  function nodeDef(n) {
    if (NODE_DEFS[n]) return NODE_DEFS[n];
    if (n === "extend_outline") return { idx: "S", title: window.t("wNodeExtendT"), desc: window.t("wNodeExtendD") };
    const m = n.match(/^ep_(\d+)$/);
    if (m) return { idx: "E" + m[1], title: window.t("wNodeEpT", { n: m[1] }), desc: window.t("wNodeEpD") };
    if (n === "import") return { idx: "📥", title: window.t("wNodeImportT"), desc: window.t("wNodeImportD") };
    return { idx: "•", title: n, desc: "" };
  }

  function createWNode(key, def) {
    const empty = $("#wCanvasEmpty");
    if (empty) empty.remove();
    let el = document.getElementById("wnode-" + key);
    if (el) return el;
    el = document.createElement("div");
    el.className = "node running open";
    el.id = "wnode-" + key;
    el.innerHTML = `<div class="node-head"><span class="node-idx">${esc(String(def.idx))}</span>
      <div><div class="node-title">${esc(def.title)}</div><div class="node-desc">${esc(def.desc || "")}</div></div>
      <span class="node-state">${window.t("wGenerating")}</span></div>
      <div class="node-body"><span class="dim small">${window.t("nodeRunning")}</span></div>`;
    $("#wCanvas").appendChild(el);
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return el;
  }

  function nodeBody(key, d) {
    if (key === "import") {
      return `${window.t("wLblStory")}：${esc(d.story || "")}<br />${window.t("wLblHero")}：${esc(d.hero || "")}<br />${window.t("wLblFuture")}：${esc((d.outline_text || "").slice(0, 80))}…`;
    }
    if (key === "parse_idea") {
      return `${window.t("wLblStory")}：${esc(d.logline || "")}<br />${window.t("wLblHero")}：${esc(d.hero || "")}<br />${window.t("wLblConflict")}：${esc(d.conflict || "")}<br />${window.t("wLblSelling")}：${esc(d.selling_point || "")}`;
    }
    if (key === "kb_search") {
      const hits = (d.hits || []).map((h) => `${esc(h.title)}（${esc(h.genre)}）`).join("、");
      return `${window.t("wLblRecall")}：${hits || window.t("noResult")}<br />${window.t("wLblBeats")}：${esc((d.template && d.template.common_beats || []).slice(0, 3).join(" → "))}`;
    }
    if (key === "outline" || key === "extend_outline") {
      return d.text ? fmtText(d.text) : `<span class="dim">${esc(d.note || window.t("wCovered"))}</span>`;
    }
    if (key === "script") return fmtText(d.text || "");
    if (key === "quality_check") {
      const rows = (d.checks || []).map((c) => `${c.ok ? "✓" : "✗"} ${esc(c.item)} <span class="dim">— ${esc(c.detail)}</span>`).join("<br />");
      return `<b style="color:${d.score >= 80 ? "var(--brand)" : "var(--warn)"}">${window.t("wQcScore", { score: d.score, pass: d.pass ? window.t("wQcPass") : window.t("wQcFix") })}</b><br />${rows}`;
    }
    if (key === "refine") {
      return `${window.t("wRefineScore", { before: d.before_score })}<b style="color:var(--brand)">${d.after_score}</b>（${esc(d.engine || "")}）<br />${fmtText(d.text || "")}`;
    }
    if (key === "scenes") return `${window.t("wScenesOut", { n: (d.scenes || []).length })}${(d.scenes || []).map((s) => esc(s.location)).join(" / ")}`;
    if (key === "storyboard") return window.t("wShotsOut", { n: (d.shots || []).length });
    if (/^ep_\d+$/.test(key)) {
      const color = d.score >= 80 ? "var(--brand)" : "var(--warn)";
      return `<b style="color:${color}">${window.t("wEpQc", { no: d.no, score: d.score, pass: d.pass ? window.t("wEpPass") : window.t("wEpFix") })}</b> <span class="dim">${esc(d.summary || "")}</span><br />${fmtText(d.text || "")}`;
    }
    return esc(JSON.stringify(d).slice(0, 300));
  }

  function setWNodeDone(key, data) {
    const el = document.getElementById("wnode-" + key) || createWNode(key, nodeDef(key));
    el.className = "node done open";
    el.querySelector(".node-state").textContent = window.t("stateDone");
    el.querySelector(".node-body").innerHTML = nodeBody(key, data);
  }

  function renderEvent(ev) {
    const n = ev.node || "";
    if (n.startsWith("_")) return; // 内部状态节点（_done/_stage_done/_error）由 stage 分支处理
    if (ev.status === "running") createWNode(n, nodeDef(n));
    else if (ev.status === "done") setWNodeDone(n, ev.data || {});
  }

  function resetCanvas(msg) {
    $("#wCanvas").innerHTML = `<div class="canvas-empty" id="wCanvasEmpty"><div class="empty-icon">⬡</div><p>${esc(msg || window.t("wPreparing"))}</p><p class="small">${window.t("wNodesLight")}</p></div>`;
    $("#wSatisfy").classList.add("hidden");
    $("#wResult").classList.add("hidden");
    rendered = 0;
    stageSeen = "";
  }

  /* ---------- 轮询 ---------- */
  function startPoll() {
    if (timer) clearInterval(timer);
    timer = setInterval(pollOnce, 1200);
    pollOnce();
  }

  async function pollOnce() {
    if (!tid) return;
    try {
      const r = await fetch("/api/writer/tasks/" + tid);
      if (!r.ok) return;
      const t = await r.json();
      const evs = t.events || [];
      for (; rendered < evs.length; rendered++) renderEvent(evs[rendered]);
      $("#wChip").textContent = t.status === "suspended" ? window.t("wSuspendedChip") : (t.status || t.stage);
      if (t.status === "suspended") {
        clearInterval(timer); timer = null;
        showSatisfy(t, { silent: true }); // 挂起面板：已完成集可见，「继续生成」= 断点续跑
        toast(window.t("wSuspendedToast"), false);
        return;
      }
      if (t.stage !== stageSeen) {
        stageSeen = t.stage;
        if (t.stage === "stage_done") { clearInterval(timer); timer = null; showSatisfy(t); }
        else if (t.stage === "done") { clearInterval(timer); timer = null; showResult(t); }
        else if (t.stage === "error") { clearInterval(timer); timer = null; toast(window.t("wExecErr") + (t.error || ""), false); }
      }
    } catch {}
  }

  /* ---------- ②' 导入已有成品 → 直接可续写 ---------- */
  async function importContent() {
    const text = $("#wImport").value.trim();
    if (!text) return toast(window.t("wImportNeed"), false);
    resetCanvas(window.t("wParsing"));
    try {
      const r = await fetch("/api/writer/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text, target: +$("#wTarget").value || 10,
          market: window.duanjuMarket || "china",
          output_locale: $("#wLocale")?.value || (window.duanjuMarket === "japan" ? "ja-JP" : "zh-CN"),
          content_type: $("#wContentType")?.value || "short_drama",
        }),
      });
      const j = await r.json();
      if (!j.ok) return toast(window.t("wImportFail") + "：" + (j.detail || window.t("wFmtMismatch")), false);
      tid = j.tid;
      window.WorkspaceUI?.closeDrawer(true);
      const a = j.agg || {};
      const eps = j.episodes || []; // 后端拆分出的第2集及以后成品（stage=done，可直接加集）
      createWNode("import", nodeDef("import"));
      setWNodeDone("import", a);
      stageSeen = eps.length ? "done" : "stage_done";
      showSatisfy(
        { agg: a, cont: { episodes: eps, target: j.target }, target: j.target },
        { done: eps.length > 0 }
      );
      const totalEps = eps.length + (a.ep1_script ? 1 : 0);
      toast(totalEps > 1 ? window.t("wImportEps", { n: totalEps })
        : a.card ? window.t("wImportCard")
        : window.t("wImportDone2"), true);
    } catch (e) {
      toast("导入失败：" + e.message, false);
    }
  }

  /* ---------- ②'' 剧本库一键续写 ---------- */
  async function continueFromLibrary(lid) {
    try {
      const r = await fetch(`/api/library/${encodeURIComponent(lid)}`);
      if (!r.ok) throw new Error(window.t("loadFail"));
      if (!r.ok) return toast(window.t("loadFail"), false);
      const item = await r.json();
      // 结构化判断：图谱同步条目（source="知识图谱"）的 script 是资料卡而非正文；
      // 前缀正则仅作旧数据兜底。误判会把图谱描述当第1集正文，续写直接跳过第1集
      const isCard = item.record_type === "source_reference" || item.source === "知识图谱" || /^【图谱资料卡】/.test((item.script || "").trim());
      // 一句话故事取 outline 首行（生成条目的 outline 是多行大纲，整段当故事会污染上下文）
      const story = (item.outline || "").trim().split("\n")[0].slice(0, 80) || item.title || "";
      const md = [
        `## 《${item.title}》`, "",
        `- **题材**：${item.genre || ""}`,
        `- **一句话故事**：${story}`,
        ...(item.hero ? [`- **主角**：${item.hero}`] : []), // 值为空就整行省略，避免污染解析
        ...(item.hot_tags && item.hot_tags.length ? [`- **热点标签**：${item.hot_tags.join("、")}`] : []),
      ];
      if (isCard) {
        // 资料卡的钩子/反转/节拍单独成段：导入后作为剧情资料注入续写上下文（而非第1集正文）
        const cardBody = (item.read_only ? [item.outline, item.excerpt].filter(Boolean).join("\n") : item.script || "").trim()
          .replace(/^【图谱资料卡】[^\n]*\n?/, "")
          .replace(/[-*]\s*\*\*?一句话故事\*\*?[:：][^\n]*\n?/, "")
          .trim();
        md.push("", "### 剧情资料（参考资料，非正文）", cardBody);
      } else {
        // 生成条目：outline 全文进「后续走向」（剔除与一句话故事重复的首行），script 是真实第1集正文
        const olLines = (item.outline || "").trim().split("\n");
        if (olLines[0] && olLines[0].trim() === story) olLines.shift();
        const olBody = olLines.join("\n").trim();
        if (olBody) md.push("", "### 后续走向", olBody);
        md.push("", "### 第 1 集", "", item.script || "");
      }
      $("#wImport").value = md.join("\n");
      await importContent();
    } catch (e) {
      toast(window.t("wOneClickFail") + e.message, false);
    }
  }

  /* ---------- 历史任务：列表 / 载入重放 / 接入实时进度 ---------- */
  function stageLabel(s, st) {
    if (st === "suspended") return window.t("wStSuspended2");
    return { stage1: window.t("wStStage1"), stage_done: window.t("wStStageDone"), stage2: window.t("wStStage2"),
             done: window.t("wStDone"), error: window.t("wStError") }[s] || st || s;
  }

  async function loadHistory() {
    try {
      const r = await fetch(`/api/writer/tasks?market=${encodeURIComponent(window.duanjuMarket || "china")}`);
      const j = await r.json();
      if (j.ok) {
        history = j.items || [];
        renderHistory();
      }
    } catch {}
  }

  function renderHistory() {
    const box = $("#wHistList");
    if (!box) return;
    if (!history.length) {
      box.innerHTML = `<div class="empty">${window.t("wHistEmpty")}</div>`;
      return;
    }
    box.innerHTML = history.map(t => `
      <div class="library-item" style="padding:8px;border-bottom:1px solid #eee;">
        <div><strong>${esc(t.title)}</strong>
          ${t.source === "工作台" ? `<span class="chip on" style="font-size:10px;padding:1px 6px">${window.t("studio")}</span>` : ""}
          ${t.running ? `<span class="chip on" style="font-size:10px;padding:1px 6px">${window.t("wRunningChip")}</span>`
            : t.status === "suspended" ? `<span class="chip" style="font-size:10px;padding:1px 6px">${window.t("wSuspendedShort")}</span>` : ""}</div>
        <div class="small dim">${esc(t.genre || "")} · ${window.t("wEpsDone", { done: t.eps_done, total: t.target })} · ${esc(stageLabel(t.stage, t.status))}</div>
        <button class="sm secondary hist-load-btn" data-tid="${t.tid}" style="float:right;margin-top:-20px;" data-i18n="wLoad">${window.t("wLoad")}</button>
      </div>
    `).join("");
    $$(".hist-load-btn").forEach(btn => {
      btn.addEventListener("click", () => loadHistoryTask(btn.dataset.tid));
    });
  }

  async function loadHistoryTask(tidParam) {
    try {
      const r = await fetch("/api/writer/tasks/" + tidParam);
      if (!r.ok) return toast(window.t("wLoadFail"), false);
      const t = await r.json();
      tid = t.tid;
      window.WorkspaceUI?.closeDrawer(true);
      resetCanvas(window.t("wLoadingHist"));
      // 事件重放：每个节点取最后一次事件（running 保持生成中态，done 回填成果）
      const evs = t.events || [];
      const lastOf = {};
      const order = [];
      for (const ev of evs) {
        const n = ev.node || "";
        if (!n || n.startsWith("_")) continue;
        if (!(n in lastOf)) order.push(n);
        lastOf[n] = ev;
      }
      for (const n of order) {
        createWNode(n, nodeDef(n));
        if (lastOf[n].status === "done") setWNodeDone(n, lastOf[n].data || {});
      }
      if (!order.length && t.agg && t.agg.title) { // 导入类任务无事件流，用 agg 合成节点
        createWNode("import", nodeDef("import"));
        setWNodeDone("import", t.agg);
      }
      rendered = evs.length;
      stageSeen = t.stage;
      $("#wChip").textContent = window.t("wHistChip") + stageLabel(t.stage, t.status);
      if (t.stage === "stage_done") {
        showSatisfy(t, { silent: true });
        toast(window.t("wLoadedConfirm"), true);
      } else if (t.stage === "done") {
        showSatisfy(t, { silent: true, done: true });
        showResult(t);
        toast(window.t("wLoadedDone"), true);
      } else if (t.status === "suspended") {
        showSatisfy(t, { silent: true }); // 已有分集 → 自动进入加集锁锚点模式，「继续生成」即断点续跑
        toast(window.t("wSuspendedToast2"), false);
      } else if (t.stage === "error") {
        toast(window.t("wLastErr", { err: t.error || "" }), false);
      }
      if (t.status === "running") startPoll(); // 运行中任务接入实时进度
    } catch (e) {
      toast(window.t("wLoadFail") + "：" + e.message, false);
    }
  }

  /* ---------- ③ 满意度确认 ---------- */
  // 旧任务数据兜底：图谱资料卡曾被误存进 ep1_script，展示/导出时识别并跳过
  const isCardText = (s) => /^【图谱资料卡】/.test((s || "").trim());

  function showSatisfy(t, opts = {}) {
    const a = t.agg || {};
    const qc = a.ep1_qc;
    const eps = ((t.cont && t.cont.episodes) || []).filter((ep) => ep && ep.text);
    const done = !!(opts.done || eps.length); // 已有分集成品 → 加集模式，锚点选项不生效
    const hasEp1 = !!((a.ep1_script && !isCardText(a.ep1_script)) || eps.some((ep) => ep.no === 1));
    const firstNo = eps.length ? eps[0].no : 1;
    const lastNo = eps.length ? eps[eps.length - 1].no : (hasEp1 ? 1 : 0);
    // 锚点选项联动：无第1集成稿时「保留第1集」两档不可选；加集模式全部锁定
    $$('input[name="wAnchor"]').forEach((el) => {
      el.disabled = done || (!hasEp1 && el.value !== "outline");
      if (!done && !el.disabled && el.value === (hasEp1 ? "both" : "outline")) el.checked = true;
    });
    $("#wSatisfyMeta").innerHTML =
      `《<b>${esc(a.title)}</b>》 · ${window.t("wLblHero")}：${esc(a.hero)}<br />${window.t("wLblStory")}：${esc(a.story)}<br />` +
      (a.ep1_script && !isCardText(a.ep1_script)
        ? (qc ? `${window.t("wQcFinal")}<b style="color:${qc.score >= 80 ? "var(--brand)" : "var(--warn)"}">${qc.score} ${window.t("wScoreUnit")}</b>（${esc(qc.summary || "")}）` : window.t("wEp1Imported"))
        : hasEp1 ? window.t("wEp1InEps") : window.t("wEp1Pending")) +
      (done ? `<br /><b style="color:var(--brand)">${window.t("wAddEps", { first: firstNo, last: lastNo, next: lastNo + 1 })}</b>` : "") +
      (a.card ? `<br /><span class="dim">${window.t("wCardNote")}</span>` : "");
    $("#wContTarget").value = Math.max((t.cont && t.cont.target) || t.target || (t.req && t.req.episodes) || 10, lastNo + 1);
    $("#wSatisfy").classList.remove("hidden");
    $("#wSatisfy").scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (!opts.silent) toast(window.t("wStageDoneToast"), true);
  }

  async function continueGen() {
    if (!tid) return;
    const anchor = (document.querySelector('input[name="wAnchor"]:checked') || {}).value || "both";
    const target = +$("#wContTarget").value || 10;
    $("#wSatisfy").classList.add("hidden");
    stageSeen = "";
    try {
      const r = await fetch(`/api/writer/tasks/${tid}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor, note: $("#wNote").value.trim(), target }),
      });
      const j = await r.json();
      if (!j.ok) return toast(window.t("wContFail") + (j.detail || ""), false);
      const from = j.start_ep || 2;
      $("#wChip").textContent = from > 2 ? window.t("wChipAdd", { from, target })
        : from === 1 ? window.t("wChipFull", { target }) : window.t("wChipStage2", { target });
      startPoll();
      toast(from > 2 ? window.t("wContAdd", { from }) : window.t("wContStart"), true);
    } catch (e) {
      toast(window.t("wContErr") + e.message, false);
    }
  }

  /* ---------- ④ 成品渲染 + 下载 ---------- */
  function showResult(t) {
    const a = t.agg || {};
    const eps = (t.cont && t.cont.episodes) || [];
    const hasGenEp1 = eps.some((ep) => ep.no === 1); // 从第1集整剧生成时，第1集在续写列表里
    const scored = eps.filter((ep) => typeof ep.score === "number"); // 导入分集 score=null，不参与均分
    const avg = scored.length ? Math.round(scored.reduce((s, e) => s + e.score, 0) / scored.length) : 0;
    const totalEps = eps.length + ((hasGenEp1 || !a.ep1_script) ? 0 : 1);
    const rows = eps.map((ep) => `
      <details class="node done" style="margin-bottom:8px">
        <summary class="node-head" style="cursor:pointer;display:flex">
          <span class="node-idx">E${ep.no}</span>
          <div><div class="node-title">${window.t("wEpNo", { n: ep.no })}</div><div class="node-desc">${esc((ep.text || "").replace(/\s/g, "").slice(0, 36))}…</div></div>
          ${typeof ep.score === "number"
            ? `<span class="node-state" style="color:${ep.score >= 80 ? "var(--brand)" : "var(--warn)"}">${ep.score} ${window.t("wScoreUnit")}${ep.review ? window.t("wHitScore", { score: ep.review.score }) : ""}</span>`
            : `<span class="node-state dim">${window.t("badgeImport")}</span>`}
        </summary>
        <div class="node-body" style="display:block">${fmtText(ep.text || "")}</div>
      </details>`).join("");
    $("#wResult").innerHTML = `
      <div class="center-head"><h2>${window.t("wResultTitle")}《${esc(a.title)}》</h2>
        <span class="chip on">${window.t("wTotalEps", { n: totalEps })}${scored.length ? window.t("wAvgScore", { avg }) : ""}</span></div>
      <details class="node done" style="margin-bottom:8px" open>
        <summary class="node-head" style="cursor:pointer;display:flex"><span class="node-idx">全</span>
          <div><div class="node-title">${window.t("wOutlineFull")}</div><div class="node-desc">${window.t("wOutlineDesc")}</div></div></summary>
        <div class="node-body" style="display:block">${fmtText(((a.outline_text || "") + "\n" + ((t.cont && t.cont.outline_ext) || "")).trim())}</div>
      </details>
      ${(hasGenEp1 || isCardText(a.ep1_script)) ? "" : `
      <details class="node done" style="margin-bottom:8px">
        <summary class="node-head" style="cursor:pointer;display:flex"><span class="node-idx">E1</span>
          <div><div class="node-title">${window.t("wEp1Final")}</div><div class="node-desc">${window.t("wEp1FinalDesc")}</div></div></summary>
        <div class="node-body" style="display:block">${fmtText(a.ep1_script || "")}</div>
      </details>`}
      ${rows}
      <button id="btnWDownload" class="primary sm" style="margin-top:10px" data-i18n="wDownload">${window.t("wDownload")}</button>`;
    $("#wResult").classList.remove("hidden");
    $("#btnWDownload").addEventListener("click", () => downloadTxt(t));
    toast(window.t("wAllDone"), true);
  }

  function downloadTxt(t) {
    const a = t.agg || {};
    const eps = (t.cont && t.cont.episodes) || [];
    const hasGenEp1 = eps.some((ep) => ep.no === 1);
    const lines = [`《${a.title}》`, "", window.t("wDlOutline"), a.outline_text || "", (t.cont && t.cont.outline_ext) || ""];
    if (!hasGenEp1 && !isCardText(a.ep1_script)) lines.push("", window.t("wDlEp1"), a.ep1_script || "");
    eps.forEach((ep) => lines.push("", window.t("wDlEp", { n: ep.no }) + (typeof ep.score === "number" ? window.t("wDlQc", { score: ep.score }) : ""), ep.text || ""));
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = window.t("wDlName", { title: a.title || window.t("wDlFallback") });
    link.click();
    URL.revokeObjectURL(url);
  }

  /* 供创意工坊工作台（app.js）调用：确保视图已激活后，一键载入指定剧本并进入续写流程 */
  async function openContinueFromLibrary(lid) {
    if (!bound) activate();
    await continueFromLibrary(lid);
  }

  return { activate, openContinueFromLibrary };
})();
