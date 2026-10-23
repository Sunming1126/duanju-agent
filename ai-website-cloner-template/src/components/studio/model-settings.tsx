"use client";

import { useState, type FormEvent } from "react";
import { backendRequest, jsonBody } from "@/lib/studio/api";
import { Modal } from "@/components/sites/storyplay/shared";

export function ModelSettings({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await backendRequest("/llm/config", {
        method: "POST",
        body: jsonBody({
          api_key: String(data.get("key") || "").trim(),
          api_base: String(data.get("base") || "").trim(),
          model: String(data.get("model") || "").trim(),
        }),
      });
      form.reset();
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "配置保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="本地模型设置" onClose={onClose}>
      <form className="create-form studio-form" onSubmit={submit}>
        <p className="modal-description">
          使用剧本平台现有的 OpenAI
          兼容模型配置。密钥仅保存到本机后端，不存入浏览器或作品。
        </p>
        <label>
          API 地址
          <input
            name="base"
            type="url"
            placeholder="留空沿用后端已有配置"
            autoComplete="off"
          />
        </label>
        <label>
          模型名称
          <input
            name="model"
            placeholder="填写服务商实际可用的模型名称"
            autoComplete="off"
          />
        </label>
        <label>
          API Key
          <input
            name="key"
            type="password"
            autoComplete="new-password"
            placeholder="留空保留已有密钥"
          />
        </label>
        <p className="form-note">
          保存不自动发起模型调用。可在作品中生成一次候选验证连接。
        </p>
        {error && (
          <p className="studio-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="text-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" disabled={busy} className="pill light">
            {busy ? "保存中…" : "保存配置"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
