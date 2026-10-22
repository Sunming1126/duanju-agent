/* 类别管理 — 4 维度分类体系 / 动态添加编辑归档 / related_ids 双向关联 / 类别×内容交叉统计 */
window.CatsView = (() => {
  let dims = [], cats = [], curDim = "", sel = null;
  let usage = {};  // D2/D3/D4：{cid: {graph, corpus, hooks, graph_names[], corpus_names[]}}

  async function load() {
    const j = await fetch(`/api/categories?include_archived=true&market=${encodeURIComponent(window.duanjuMarket || "china")}`).then((r) => r.json());
    dims = j.dimensions || [];
    cats = j.categories || [];
    usage = j.usage || {};
    if (!dims.some((d) => d.key === curDim)) curDim = "";
    renderDimTabs();
    renderList();
    renderHelp();
    renderCrossStats();
  }

  function renderDimTabs() {
    const box = document.getElementById("dimTabs");
    box.innerHTML = `<button class="tab ${curDim === "" ? "active" : ""}" data-dim="" data-i18n="all">${window.t("all")}</button>` +
      dims.map((d) => `<button class="tab ${curDim === d.key ? "active" : ""}" data-dim="${esc(d.key)}">${esc(d.name)}</button>`).join("");
    box.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => { curDim = t.dataset.dim; sel = null; renderDimTabs(); renderList(); renderEditor(); }));
    const d = dims.find((x) => x.key === curDim);
    document.getElementById("dimDesc").textContent = d ? d.description : window.t("catAllDims");
  }

  function renderList() {
    const box = document.getElementById("catList");
    const list = curDim ? cats.filter((c) => c.dimension === curDim) : cats;
    box.innerHTML = list.map((c) => {
      const dim = dims.find((d) => d.key === c.dimension);
      // D2：挂接徽标（图谱实体数 · 语料数 · 钩子数），0 挂接置灰
      const u = usage[c.id] || { graph: 0, corpus: 0, hooks: 0 };
      const total = (u.graph || 0) + (u.corpus || 0) + (u.hooks || 0);
      const badge = `<span class="usage-badge${total ? "" : " dim"}">${window.t("navGraph")} ${u.graph || 0} · ${window.t("navLibrary")} ${u.corpus || 0} · ${window.t("hookLib")} ${u.hooks || 0}</span>`;
      return `
      <div class="hit cat-item ${sel && sel.id === c.id ? "sel" : ""}" data-cid="${esc(c.id)}">
        <div class="hit-title">
          <span>${esc(c.name)} ${c.archived ? `<span class="badge st-rejected">${window.t("catArchived")}</span>` : ""}</span>
          <span class="hit-score">${esc(dim ? dim.name : c.dimension)}</span>
        </div>
        <div class="hit-meta"><code>${esc(c.id)}</code> · ${window.t("uiRelated")} ${c.related_ids.length} ${badge}</div>
      </div>`;
    }).join("") || `<p class="small dim">${window.t("uiNoCategories")}</p>`;
    box.querySelectorAll(".cat-item").forEach((el) =>
      el.addEventListener("click", () => {
        sel = cats.find((c) => c.id === el.dataset.cid);
        renderList(); renderEditor();
      }));
  }

  function renderEditor() {
    const ed = document.getElementById("catEditor");
    const chip = document.getElementById("catChip");
    if (!sel) {
      chip.textContent = window.t("catNewMode");
      ed.innerHTML = newForm();
      bindEditor(null);
    } else {
      chip.textContent = sel.id;
      ed.innerHTML = editForm(sel);
      bindEditor(sel);
    }
    renderRelated();
    renderHooked();
  }

  const dimOptions = (cur) => dims.map((d) =>
    `<option value="${esc(d.key)}" ${d.key === cur ? "selected" : ""}>${esc(d.name)}（${esc(d.key)}）</option>`).join("");

  const relatedChecks = (checkedIds) => cats.filter((c) => !sel || c.id !== sel.id).map((c) =>
    `<label class="ck"><input type="checkbox" value="${esc(c.id)}" ${(checkedIds || []).includes(c.id) ? "checked" : ""}/>${esc(c.name)} <code class="dim">${esc(c.id)}</code></label>`).join("");

  function formBody(c) {
    return `
      ${c ? `<p class="small dim"><code>${esc(c.id)}</code>（${window.t("uiIdAuto")}）</p>`
          : `<label data-i18n="uiDimension">${window.t("uiDimension")}</label><select id="ceDim">${dimOptions(curDim)}</select>`}
      <label data-i18n="uiCategoryName">${window.t("uiCategoryName")}</label>
      <input id="ceName" value="${esc(c ? c.name : "")}" placeholder="${window.t("catNamePh")}"/>
      <label data-i18n="uiFeatures">${window.t("uiFeatures")}</label>
      <textarea id="ceFeat" rows="2" placeholder="${window.t("catFeatPh")}">${esc(c ? c.features : "")}</textarea>
      <label data-i18n="uiSource">${window.t("uiSource")}</label>
      <input id="ceSrc" value="${esc(c ? c.data_source : "")}" placeholder="${window.t("catSrcPh")}"/>
      <label data-i18n="uiRelatedCats">${window.t("uiRelatedCats")}</label>
      <div class="ck-group">${relatedChecks(c ? c.related_ids : [])}</div>
      <div class="act-row">
        <button id="ceSave" class="primary sm">${c ? window.t("catSave") : window.t("catCreate")}</button>
        ${c ? `<button id="ceArch" class="ghost sm">${c.archived ? window.t("catRestore") : window.t("catArchiveBtn")}</button>` : ""}
      </div>`;
  }
  const editForm = (c) => formBody(c);
  const newForm = () => formBody(null);

  function bindEditor(c) {
    const save = document.getElementById("ceSave");
    if (save) save.addEventListener("click", async () => {
      const name = document.getElementById("ceName").value.trim();
      const features = document.getElementById("ceFeat").value.trim();
      const data_source = document.getElementById("ceSrc").value.trim();
      const related_ids = [...document.querySelectorAll(".ck-group input:checked")].map((i) => i.value);
      if (!name) { window.toast(window.t("catNameNeed"), false); return; }
      try {
        if (c) {
          const j = await fetch(`/api/categories/${encodeURIComponent(c.id)}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, features, data_source, related_ids }),
          }).then((r) => r.json());
          sel = j.category || j;
          window.toast(window.t("catUpdated"));
        } else {
          const dimension = document.getElementById("ceDim").value;
          const j = await fetch("/api/categories", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dimension, name, features, data_source, related_ids }),
          }).then((r) => r.json());
          sel = j.category || j;
          window.toast(`类别已创建：${sel.id}`);
        }
        await load();
        renderEditor();
      } catch (e) { window.toast(window.t("catSaveFail") + e.message, false); }
    });
    const arch = document.getElementById("ceArch");
    if (arch) arch.addEventListener("click", async () => {
      const j = await fetch(`/api/categories/${encodeURIComponent(c.id)}/archive`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !c.archived }),
      }).then((r) => r.json());
      sel = j.category || j;
      window.toast(c.archived ? window.t("catRestored") : window.t("catArchDone"));
      await load();
      renderEditor();
    });
  }

  function renderRelated() {
    const box = document.getElementById("catRelated");
    if (!sel) { box.innerHTML = '<span class="dim">选中类别后展示双向关联。</span>'; return; }
    const direct = sel.related_ids.map((rid) => {
      const c = cats.find((x) => x.id === rid);
      return c ? esc(c.name) : esc(rid);
    });
    const reverse = cats.filter((c) => c.related_ids.includes(sel.id)).map((c) => esc(c.name));
    box.innerHTML = `
      <div>${window.t("catRelTo")}<b>${direct.join("、") || window.t("catNone")}</b></div>
      <div style="margin-top:4px">${window.t("catRelFrom")}<b>${reverse.join("、") || window.t("catNone")}</b></div>`;
  }

  /* D3：挂接内容清单 — 图谱实体前 8 条（点击跳图谱定位）+ 语料前 5 条 */
  function renderHooked() {
    const box = document.getElementById("catHooked");
    if (!sel) {
      box.innerHTML = '<span class="dim">选中类别后展示其挂接的图谱实体与语料。</span>';
      return;
    }
    const u = usage[sel.id];
    if (!u || (!(u.graph_names || []).length && !(u.corpus_names || []).length)) {
      box.innerHTML = `<span class="dim">该类别暂无挂接内容（图谱 ${u ? u.graph || 0 : 0} · 语料 ${u ? u.corpus || 0 : 0} · 钩子 ${u ? u.hooks || 0 : 0}）。可去图谱/知识库给实体或语料挂上 <code>${esc(sel.id)}</code>。</span>`;
      return;
    }
    const gBtns = (u.graph_names || []).map((n) =>
      `<button class="ghost sm hooked-item" onclick="insLocate('${esc(n).replace(/'/g, "\\'")}')">⬡ ${esc(n)}</button>`).join("");
    const cBtns = (u.corpus_names || []).map((n) =>
      `<span class="badge">${esc(n)}</span>`).join("");
    box.innerHTML = `
      <div><b>图谱实体</b>（${u.graph || 0}${(u.graph_names || []).length < (u.graph || 0) ? `，展示前 ${(u.graph_names || []).length}` : ""}）：${gBtns || `<span class="dim">${window.t("catNone")}</span>`}</div>
      <div style="margin-top:6px"><b data-i18n="catCorpusUsage">${window.t("catCorpusUsage")}</b>（${u.corpus || 0}）：${cBtns || '<span class="dim">无</span>'}</div>
      <p class="dim" style="margin-top:4px">点击实体名可跳转图谱并自动定位。</p>`;
  }

  /* D4：类别×内容交叉统计 — 按维度汇总挂接总量排行 + 0 挂接类别提醒 */
  function renderCrossStats() {
    const box = document.getElementById("extInfo");
    const withUse = cats.filter((c) => {
      const u = usage[c.id];
      return u && ((u.graph || 0) + (u.corpus || 0) + (u.hooks || 0)) > 0;
    });
    const ranked = withUse
      .map((c) => {
        const u = usage[c.id];
        return { c, total: (u.graph || 0) + (u.corpus || 0) + (u.hooks || 0), u };
      })
      .sort((a, b) => b.total - a.total);
    const empty = cats.filter((c) => !withUse.some((x) => x.id === c.id));
    const dimRow = (dkey) => {
      const sub = ranked.filter((r) => r.c.dimension === dkey);
      if (!sub.length) return "";
      const d = dims.find((x) => x.key === dkey);
      return `<p style="margin-top:6px"><b>${esc(d ? d.name : dkey)}</b>：` +
        sub.map((r) => `${esc(r.c.name)}（${r.total}）`).join("、") + "</p>";
    };
    box.innerHTML = `
      ${ranked.length
        ? dims.map((d) => dimRow(d.key)).join("")
        : '<p>暂无任何类别挂接内容。</p>'}
      ${empty.length
        ? `<p style="margin-top:8px">⚠ <b>${window.t("catZeroHooked", { n: empty.length })}</b>：${empty.map((c) => esc(c.name)).join("、")}</p>`
        : '<p style="margin-top:8px">✓ 所有类别均有挂接内容。</p>'}
      <p class="dim" style="margin-top:6px">徽标说明：图 = 图谱实体数，料 = 语料数，钩 = 钩子数。</p>`;
  }

  function renderHelp() {
    document.getElementById("catHelp").innerHTML =
      `<p>分类体系共 <b>${dims.length}</b> 个内容维度、<b>${cats.length}</b> 个类别（含归档）。</p>` +
      dims.map((d) => {
        const n = cats.filter((c) => c.dimension === d.key).length;
        return `<p><b>${esc(d.name)}</b>（${d.key}，${n} 个）：${esc(d.description)}</p>`;
      }).join("") +
      `<p class="dim" style="margin-top:6px">数据接口规范：id = <code>{维度}:{slug}</code>；图谱实体通过 category_ids 挂接类别，交叉引用经 related_ids 双向关联。</p>`;
  }

  function bind() {
    document.getElementById("btnCatNew").addEventListener("click", () => {
      sel = null;
      renderList();
      renderEditor();
    });
  }

  return {
    activate() { if (!bind._done) { bind(); bind._done = true; } load(); },
  };
})();
