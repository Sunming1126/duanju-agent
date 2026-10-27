"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/sites/storyplay/shared";
import { backendRequest, ensureStudioSpace, jsonBody, type StudioSpace } from "@/lib/studio/api";

export function SpaceInfo({ onClose }: { onClose: () => void }) {
  const [space, setSpace] = useState<StudioSpace>();
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => { void ensureStudioSpace().then(setSpace).catch(error => setNotice(error.message)); }, []);
  return <Modal title="我的创作空间" onClose={() => { if (!lock.current) onClose(); }}>
    <p className="modal-description">本浏览器拥有独立的作品、世界和生成任务，其他浏览器无法查看或修改。官方样例与语料参考仍可公开使用。</p>
    {space && <p className="studio-hint">空间编号：{space.space_id}</p>}
    <p className="modal-description">再次使用此浏览器即可继续创作。更换浏览器或清理网站数据前，请先下载作品备份。</p>
    <p className="studio-hint">模型请求全站最多同时执行 3 个，多人等待时轮流调度。同一作品的章节按顺序衔接。</p>
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
