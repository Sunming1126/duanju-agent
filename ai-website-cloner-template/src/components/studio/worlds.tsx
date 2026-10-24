"use client";

import { StudioNav } from "./editor";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Download,
  Globe2,
  Plus,
  Save,
  Upload,
} from "lucide-react";
import {
  backendRequest,
  downloadText,
  jsonBody,
  type StudioStatus,
  type World,
  type WorldInput,
  type WorldPackage,
} from "@/lib/studio/api";
import { worldDraftChecksum } from "@/lib/studio/world-codec";
import { Header, Modal } from "@/components/sites/storyplay/shared";

export function WorldWorkspace() {
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [worlds, setWorlds] = useState<World[]>([]);
  const [world, setWorld] = useState<World | null>(null);
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [section, setSection] = useState("basics");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const [state, response] = await Promise.all([
        backendRequest<StudioStatus>("/studio/status", { signal }),
        backendRequest<{ items: World[] }>("/studio/worlds", { signal }),
      ]);
      if (signal?.aborted) return;
      setStatus(state);
      setDirty(false);
      setWorlds(response.items);
      setWorld(
        (previous) =>
          response.items.find((item) => item.id === previous?.id) ||
          response.items[0] ||
          null,
      );
    } catch (cause) {
      if (!signal?.aborted)
        setError(cause instanceof Error ? cause.message : "世界读取失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
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
  function ensureSaved() {
    if (busy) return false;
    if (dirty) {
      setNotice("世界设定有未保存修改，请先保存，或导出当前草稿备份。");
      return false;
    }
    return true;
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const value = await backendRequest<World>("/studio/worlds", {
        method: "POST",
        body: jsonBody({
          name: String(data.get("name") || "").trim(),
          description: String(data.get("description") || ""),
          sections: {},
        }),
      });
      setWorlds((items) => [value, ...items]);
      setWorld(value);
      setDirty(false);
      setCreating(false);
      setNotice("世界已创建。可逐步填写设定，之后在作品中绑定。");
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!world) return;
    setBusy(true);
    try {
      const value = await backendRequest<World>(`/studio/worlds/${world.id}`, {
        method: "PUT",
        body: jsonBody({
          name: world.name,
          description: world.description,
          sections: world.sections,
          archived: world.archived || false,
          revision: world.revision,
        }),
      });
      setWorld(value);
      setWorlds((items) => [
        value,
        ...items.filter((item) => item.id !== value.id),
      ]);
      setDirty(false);
      setNotice(
        `世界 v${value.revision} 已保存。已生成的作品和候选不会被自动改写。`,
      );
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "保存失败，当前编辑内容仍保留。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function exportWorld() {
    if (!world) return;
    setBusy(true);
    try {
      const payload: Omit<WorldPackage, "checksum"> = {
        schema: "onesay.world-draft",
        version: 1,
        world: {
          name: world.name,
          description: world.description,
          sections: world.sections,
        },
      };
      const checksum = await worldDraftChecksum(payload);
      if (!dirty) {
        const verified = await backendRequest<WorldPackage>(
          `/studio/worlds/${world.id}/export`,
        );
        if (verified.checksum !== checksum)
          throw new Error(
            "服务器中的世界已更新，请先刷新再导出，或保存当前内容。",
          );
      }
      downloadText(
        `${world.name}-世界.json`,
        JSON.stringify({ ...payload, checksum }, null, 2),
        "application/json;charset=utf-8",
      );
      setNotice(
        dirty
          ? "已导出当前尚未保存的世界草稿，后端版本未改动。"
          : "世界包已导出，包含完整设定和校验信息。",
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }
  async function importWorld(file: File) {
    if (!ensureSaved()) return;
    if (file.size > 1024 * 1024) {
      setNotice("世界包超过 1 MB，请检查文件。");
      return;
    }
    setBusy(true);
    try {
      const value: unknown = JSON.parse(await file.text());
      const result = await backendRequest<World>("/studio/worlds/import", {
        method: "POST",
        body: jsonBody(value),
      });
      setWorlds((items) => [result, ...items]);
      setWorld(result);
      setDirty(false);
      setNotice("世界包已导入为独立的新世界，原世界未覆盖。");
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "导入失败，原数据未改动。",
      );
    } finally {
      setBusy(false);
    }
  }
  function update(patch: Partial<WorldInput>) {
    if (world) {
      setWorld({ ...world, ...patch });
      setDirty(true);
    }
  }
  const current = status?.world_sections.find((item) => item.id === section);
  return (
    <div
      className="workspace-page"
      onClickCapture={(event) => {
        if (
          (dirty || busy) &&
          event.target instanceof Element &&
          event.target.closest("a")
        ) {
          event.preventDefault();
          setNotice("请先保存世界设定或导出草稿后再离开。");
        }
      }}
    >
      <Header workspace />
      <div className="plotloom-shell">
        <StudioNav selected="世界模型" />
        <main className="plotloom-main">
          <div className="workspace-title">
            <div>
              <span className="eyebrow">WORLD BUILDING</span>
              <h1>
                我的世界<span>先建立规则，再让故事发生</span>
              </h1>
            </div>
            <button
              className="pill light"
              disabled={loading || !!error || busy}
              onClick={() => {
                if (ensureSaved()) {
                  setCreating(true);
                  setFormError("");
                }
              }}
            >
              <Plus size={16} /> 新建世界
            </button>
          </div>
          {error && (
            <p className="storage-warning" role="alert">
              {error}
              <button className="text-button" onClick={() => void load()}>
                重新连接
              </button>
            </p>
          )}
          <div className="works-toolbar"><input aria-label="搜索世界" placeholder="搜索世界名称" value={search} onChange={e => setSearch(e.target.value)} /><label><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />显示归档世界</label></div>
          <div className="works-filters">{status?.world_sections.map(s => <button key={s.id} className={s.id === section ? "active" : ""} onClick={() => setSection(s.id)}>{s.label}</button>)}</div>
          <div className="studio-world-toolbar">
            <button
              className="text-button"
              disabled={busy || loading}
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm(
                    "重新加载会放弃未保存的世界设定。请先导出备份；确定重新加载吗？",
                  )
                )
                  void load();
              }}
            >
              重新加载
            </button>
            <label>
              当前世界
              <select
                disabled={dirty || busy}
                value={world?.id || ""}
                onChange={(event) =>
                  setWorld(
                    worlds.find((item) => item.id === event.target.value) ||
                      null,
                  )
                }
              >
                <option value="">选择世界</option>
                {worlds.filter(item => !!item.archived === archived && item.name.includes(search)).map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name} · v{item.revision}
                  </option>
                ))}
              </select>
            </label>
            <label className="outline-button studio-import-world">
              <Upload size={14} /> 导入世界包
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void importWorld(file);
                }}
              />
            </label>
            {world && (
              <>
                <button className="outline-button" disabled={busy || dirty} onClick={async () => { setBusy(true); try { const value = await backendRequest<World>("/studio/worlds", { method: "POST", body: jsonBody({ name: world.name.slice(0, 74) + " · 副本", description: world.description, sections: world.sections }) }); await load(); setWorld(value); setNotice("已复制为独立世界"); } catch(e) { setNotice(String(e)); } finally { setBusy(false); } }}>复制</button>
                <button className="outline-button" disabled={busy || dirty} onClick={async () => { setBusy(true); try { const value = await backendRequest<World>(`/studio/worlds/${world.id}`, { method: "PUT", body: jsonBody({ name: world.name, description: world.description, sections: world.sections, revision: world.revision, archived: !world.archived }) }); await load(); setWorld(value); setNotice(value.archived ? "世界已归档，作品副本不受影响" : "世界已恢复"); } catch(e) { setNotice(String(e)); } finally { setBusy(false); } }}>{world.archived ? "恢复" : "归档"}</button>
                <button
                  className="outline-button"
                  disabled={busy}
                  onClick={() => void exportWorld()}
                >
                  <Download size={14} /> 导出
                </button>
                <button
                  className="pill light"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  <Save size={14} /> 保存设定
                </button>
              </>
            )}
          </div>
          {notice && (
            <p className="studio-inline-notice" role="status">
              {notice}
            </p>
          )}
          {loading ? (
            <div className="empty-workspace">正在读取世界…</div>
          ) : !world ? (
            <div className="empty-workspace">
              <Globe2 size={38} strokeWidth={1} />
              <h2>还没有世界设定</h2>
              <p>
                创建规则、角色、地点和历史，为小说或剧本提供一致的创作背景。
              </p>
            </div>
          ) : (
            <>
              <div className="studio-world-summary">
                <label>
                  世界名称
                  <input
                    disabled={busy}
                    maxLength={80}
                    value={world.name}
                    onChange={(event) => update({ name: event.target.value })}
                  />
                </label>
                <label>
                  一句话概述
                  <textarea
                    disabled={busy}
                    rows={2}
                    maxLength={5000}
                    value={world.description}
                    onChange={(event) =>
                      update({ description: event.target.value })
                    }
                  />
                </label>
                <p>
                  v{world.revision} ·{" "}
                  {dirty ? "有未保存的修改" : "已保存到服务器"} ·
                  作品绑定时复制当前版本，之后各自独立
                </p>
              </div>
              <section className="editor-panel">
                <div className="editor-panel-heading">
                  <div>
                    <h2>{current?.label}</h2>
                    <p>{current?.description}</p>
                  </div>
                </div>
                <div className="studio-world-fields create-form">
                  {current?.fields.map((field) => (
                    <label key={field.key}>
                      {field.label}
                      <textarea
                        disabled={busy}
                        rows={6}
                        maxLength={20000}
                        value={world.sections[field.key] || ""}
                        onChange={(event) =>
                          update({
                            sections: {
                              ...world.sections,
                              [field.key]: event.target.value,
                            },
                          })
                        }
                        placeholder={`写下${field.label}，避免彼此矛盾的设定。`}
                      />
                    </label>
                  ))}
                </div>
              </section>
            </>
          )}
          <p className="workspace-disclaimer">
            本版适配了 StoryForge
            的世界模块分类与冻结引用方式，不包含其地图、游戏和完整备份协议。
          </p>
        </main>
      </div>
      {creating && (
        <Modal title="新建世界" wide onClose={() => setCreating(false)}>
          <form className="create-form studio-form" onSubmit={create}>
            <label>
              世界名称
              <input
                name="name"
                required
                maxLength={80}
                placeholder="例如：雾海群岛"
              />
            </label>
            <label>
              世界概述
              <textarea
                name="description"
                maxLength={5000}
                rows={4}
                placeholder="故事发生在怎样的世界？最重要的一条规则是什么？"
              />
            </label>
            {formError && (
              <p className="studio-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="text-button"
              >
                取消
              </button>
              <button disabled={busy} className="pill light" type="submit">
                创建世界
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
