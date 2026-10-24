"use client";

import { useState, type FormEvent } from "react";
import {
  backendRequest,
  jsonBody,
  type ContentType,
  type Reference,
  type Work,
  type WorkInput,
  type World,
} from "@/lib/studio/api";

const payloadGenre = (data: FormData) => String(data.get("genre") || "都市");

export function WorkForm({
  mode,
  worlds,
  reference,
  onCreated,
  onClose,
}: {
  mode: string;
  worlds: World[];
  reference?: Reference;
  onCreated: (work: Work, generate: boolean) => void | Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<ContentType>(
    reference?.content_type || (mode === "小说创作" ? "novel" : "short_drama"),
  );
  const [premise, setPremise] = useState(
    reference
      ? `参考素材：${reference.title}\n${reference.logline}\n${reference.hook}\n\n我的创作方向：`
      : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const generate = !(
      submitter instanceof HTMLButtonElement && submitter.value === "draft"
    );
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const payload: WorkInput = {
      title: String(data.get("title") || "").trim(),
      content_type: type,
      genre: String(data.get("genre")),
      mode,
      units: Number(data.get("units")),
      premise: premise.trim(),
      characters: "",
      outline: "",
      chapters: [],
      world_id: String(data.get("world_id") || "") || null,
      audience: String(data.get("audience")) as WorkInput["audience"],
      words_per_chapter: Number(data.get("words")),
      market: "china",
      output_locale: "zh-CN",
      reference_ids: reference ? [reference.id] : [],
      creative: {
        genres: String(data.get("genres") || payloadGenre(data)).split(/[,，]/).map(x => x.trim()).filter(Boolean),
        core: String(data.get("core") || "").split(/[,，]/).map(x => x.trim()).filter(Boolean),
        styles: String(data.get("styles") || "").split(/[,，]/).map(x => x.trim()).filter(Boolean),
        highlights: String(data.get("highlights") || ""),
        source_text: mode === "小说改编" || mode === "剧本改写" ? premise : "",
      },
    };
    if ((payload.creative?.genres?.length || 0) > 3 || (payload.creative?.core?.length || 0) > 3 || (payload.creative?.styles?.length || 0) > 5) {
      setError("题材和核心设定各最多3项，风格最多5项，使用逗号分隔。"); setBusy(false); return;
    }
    if (!payload.title) {
      setError("请填写作品名称。");
      setBusy(false);
      return;
    }
    if (generate && !payload.premise) {
      setError("请先填写故事想法；如果想稍后再写，可以选择仅创建草稿。");
      setBusy(false);
      return;
    }
    try {
      await onCreated(
        await backendRequest<Work>("/studio/works", {
          method: "POST",
          body: jsonBody(payload),
        }),
        generate,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="create-form studio-form" onSubmit={submit}>
      <p className="modal-description">
        填写故事想法后，点击“创建并 AI 生成”，AI
        会先完善故事设定。确认采纳后，可继续生成人物、大纲和正文。
      </p>
      <label>
        作品名称
        <input
          name="title"
          required
          maxLength={80}
          placeholder="给故事起个名字"
        />
      </label>
      <div className="form-row">
        <label>
          创作类型
          <select
            value={type}
            onChange={(event) => setType(event.target.value as ContentType)}
            disabled={!!reference}
          >
            <option value="short_drama">剧本创作</option>
            <option value="novel">小说创作</option>
          </select>
        </label>
        <label>
          计划{type === "novel" ? "章节" : "集数"}
          <input
            name="units"
            type="number"
            min={1}
            max={200}
            defaultValue={12}
            required
          />
        </label>
        <label>
          题材
          <select name="genre" defaultValue={reference?.genre || "都市"}>
            {Array.from(
              new Set([
                reference?.genre || "都市",
                "都市",
                "悬疑",
                "玄幻",
                "古装",
                "甜宠",
                "家庭",
                "科幻",
                "其他",
              ]),
            ).map((genre) => (
              <option key={genre}>{genre}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>
          目标受众
          <select name="audience">
            <option value="general">不限</option>
            <option value="male">男性向</option>
            <option value="female">女性向</option>
          </select>
        </label>
        <label>
          每{type === "novel" ? "章" : "集"}目标字数
          <select name="words">
            <option value={800}>800 字</option>
            <option value={1000}>1000 字</option>
            <option value={1500}>1500 字</option>
            <option value={2000}>2000 字</option>
          </select>
        </label>
        <label>
          绑定世界
          <select name="world_id">
            <option value="">暂不绑定</option>
            {worlds.map((world) => (
              <option value={world.id} key={world.id}>
                {world.name} · v{world.revision}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>自定义题材（最多3项，逗号分隔）<input name="genres" placeholder="留空使用上方题材" maxLength={240} /></label>
        <label>核心设定（最多3项）<input name="core" placeholder="时间循环，身份错位" maxLength={240} /></label>
        <label>风格（最多5项）<input name="styles" placeholder="温暖，悬疑" maxLength={400} /></label>
      </div>
      <label>核心亮点<textarea name="highlights" rows={2} maxLength={5000} /></label>
      <label>
        {mode === "小说改编"
          ? "小说素材与改编方向"
          : mode === "剧本改写"
            ? "已有原稿与改写方向"
            : "故事想法"}
        <textarea
          rows={6}
          maxLength={50000}
          value={premise}
          onChange={(event) => setPremise(event.target.value)}
          placeholder="人物是谁？想要什么？会遇到怎样的冲突？"
        />
      </label>
      <label className="studio-file-input">
        导入 TXT 素材（最多 2 MB / 50,000 字符，将替换上方文本）
        <input
          type="file"
          accept=".txt,text/plain"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setError("");
            if (file.size > 2 * 1024 * 1024) {
              setError("文件超过 2 MB。");
              return;
            }
            try {
              const text = await file.text();
              if (text.length > 50000) {
                setError("文件超过 50,000 字符。");
                return;
              }
              setPremise(text);
            } catch {
              setError("文件读取失败。");
            }
          }}
        />
      </label>
      <p className="form-note">
        当前仅使用中国市场、中文输出。参考素材只作启发，不会自动当成正文。
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
        <button
          type="submit"
          name="intent"
          value="generate"
          className="pill light"
          disabled={busy}
        >
          {busy ? "正在创建…" : "创建并 AI 生成"}
        </button>
        <button
          type="submit"
          name="intent"
          value="draft"
          className="outline-button"
          disabled={busy}
        >
          仅创建草稿
        </button>
      </div>
    </form>
  );
}
