"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/sites/storyplay/shared";
import { backendRequest, ensureStudioSpace, jsonBody, type StudioSpace, type StudioStatus } from "@/lib/studio/api";

export function SpaceInfo({ onClose }: { onClose: () => void }) {
  const [space, setSpace] = useState<StudioSpace>();
  const [status, setStatus] = useState<StudioStatus>();
  const [modelError, setModelError] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => { void ensureStudioSpace().then(setSpace).catch(error => setNotice(error.message)); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void backendRequest<StudioStatus>("/studio/status", { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setStatus(value);
    }).catch(error => { if (!controller.signal.aborted) setModelError(error.message); });
    return () => controller.abort();
  }, []);
  return <Modal title="我的空间" onClose={() => { if (!lock.current) onClose(); }}>
    <p className="modal-description">{space?.user ? `当前已登录 ${space.user.email}，作品、世界和生成任务归属于此账号，其他浏览器登录后可继续访问。` : "本浏览器拥有独立的作品、世界和生成任务。可通过首页右上角登录，将此空间关联新账号。"}官方样例与语料参考仍可公开使用。</p>
    {space && <p className="studio-hint">空间编号：{space.space_id}</p>}
    <p className="modal-description">{space?.user ? "退出登录会进入新的访客空间，不会删除账号中的作品。建议定期下载作品备份。" : "再次使用此浏览器即可继续创作。更换浏览器或清理网站数据前，请先下载作品备份。"}</p>
    <section className="space-model-info" aria-labelledby="space-model-heading">
      <h3 id="space-model-heading">模型信息</h3>
      {status ? <dl><div><dt>当前模型</dt><dd>{status.model || "未配置"}</dd></div><div><dt>服务状态</dt><dd>{status.llm_ready ? "服务端已配置" : "服务端尚未配置"}</dd></div></dl> : modelError ? <p className="studio-error" role="alert">模型信息读取失败：{modelError}</p> : <p className="studio-hint" role="status">正在读取模型信息…</p>}
      <p className="studio-hint">模型由服务端统一维护。全站最多同时执行 {status?.max_concurrent_requests ?? 3} 个模型请求，多人等待时轮流调度，同一作品的章节按顺序衔接。</p>
    </section>
    <details className="space-recovery"><summary>恢复以前的共享作品</summary><p className="studio-hint">使用维护者提供的一次性恢复码，将原共享作品和世界转入当前空间。原稿会完整保留。</p>
      <form onSubmit={async event => {
        event.preventDefault(); if (lock.current || !code.trim()) return;
        lock.current = true; setBusy(true); setNotice("");
        try {
          await backendRequest("/studio/session/claim-legacy", { method: "POST", body: jsonBody({ code: code.trim() }) });
          setCode(""); setNotice("原有作品已恢复到本空间，请刷新作品列表查看。");
        } catch (error) { setNotice(error instanceof Error ? error.message : "恢复失败，请重试。"); }
        finally { lock.current = false; setBusy(false); }
      }}><label>一次性恢复码<input type="password" autoComplete="off" minLength={20} maxLength={128} required value={code} disabled={busy} onChange={event => setCode(event.target.value)} /></label><button className="pill light" disabled={busy || !space}>{busy ? "正在恢复…" : "恢复到本空间"}</button></form>
    </details>
    {notice && <p className="studio-inline-notice" role="status">{notice}</p>}
  </Modal>;
}
