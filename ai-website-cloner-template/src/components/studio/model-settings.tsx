"use client";
import { useEffect, useState } from "react";
import { backendRequest, type StudioStatus } from "@/lib/studio/api";
import { Modal } from "@/components/sites/storyplay/shared";
export function ModelSettings({ onClose }: { onClose: () => void; onSaved?: () => void }) {
  const [state, setState] = useState<StudioStatus>();
  const [error, setError] = useState("");
  useEffect(() => { backendRequest<StudioStatus>("/studio/status").then(setState).catch(e => setError(e.message)); }, []);
  return <Modal title="模型信息" onClose={onClose}>
    <p>模型：{state?.model || "正在读取…"}</p>
    <p>{state ? state.llm_ready ? "服务端已配置" : "服务端尚未配置" : error}</p>
    <p className="modal-description">模型由服务端统一维护。公开页面仅供查看；作品和世界库由访客共享。</p>
  </Modal>;
}
