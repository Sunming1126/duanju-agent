# -*- coding: utf-8 -*-
"""语料深加工与人工导入通道

- polish()：LLM 批量补全 corpus_live.json 条目的高价值字段（hook/reversal/golden_lines/beats），
  已加工条目打 _polished 标记跳过，逐步积累；采集刷新后标记丢失可重跑。
- merge_manual_items()：人工导入语料合并进 data/corpus_manual.json（独立于采集产物，
  不会被 /api/collect 刷新覆盖），knowledge.py 自动合并进知识库。
"""
import csv
import hashlib
import io
import json
import re
import time
from datetime import datetime
from pathlib import Path

from . import collector, llm
from .market import normalize_item

LIVE = collector.OUT
MANUAL = collector.ROOT / "data" / "corpus_manual.json"

POLISH_BATCH = 5
# 每批 LLM 补全字段（logline 保留采集原文不覆盖）
POLISH_FIELDS = ("hook", "reversal", "golden_lines", "beats")

_PROMPT = """你是爆款短剧编剧顾问。下面是 {n} 条网文/短剧条目（标题+题材+简介），请为每条生成短剧改编视角的结构化字段。

条目：
{entries}

只返回 JSON 数组，每项格式：
[{{"n": 1, "hook": "...", "reversal": "...", "golden_lines": ["..."], "beats": ["...", "..."]}}]

要求：
- hook：60字内开场钩子，冲突/悬念前置，前3秒留人（身份反差、极端处境、当众打脸等）
- reversal：一句话核心反转或爽点
- golden_lines：1-2 条金句台词（打脸/立人设），短促有力
- beats：3-5 个剧情节拍，每个 ≤20 字
- 基于条目已有信息合理演绎，不编造世界观，hook 不得与简介首句雷同"""


def _load(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"updated": "", "source": "", "items": []}


def _save(path: Path, payload: dict, label: str):
    payload["updated"] = datetime.now().isoformat(timespec="seconds")
    payload["source"] = label
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def _dedupe(items: list[dict]) -> list[dict]:
    seen, uniq = set(), []
    for it in items:
        if it.get("id") in seen:
            continue
        seen.add(it["id"])
        uniq.append(it)
    return uniq


# ---------------- 人工导入 ----------------

_HEADER_MAP = {
    "title": "title", "标题": "title", "书名": "title", "剧名": "title", "名称": "title",
    "genre": "genre", "题材": "genre", "类型": "genre", "分类": "genre",
    "logline": "logline", "简介": "logline", "一句话": "logline", "梗概": "logline",
    "hook": "hook", "钩子": "hook", "开场": "hook",
    "tags": "tags", "标签": "tags",
    "reversal": "reversal", "反转": "reversal",
    "golden_lines": "golden_lines", "金句": "golden_lines",
    "beats": "beats", "节拍": "beats",
    "author": "author", "作者": "author",
    "platform": "platform", "来源": "platform", "平台": "platform",
}


def parse_import_text(text: str) -> tuple[list[dict], str]:
    """解析导入文本，返回 (items, fmt)。支持 JSON 数组 / CSV（含表头）/ MD（## 分块 key: value）。"""
    text = text.strip()
    if not text:
        return [], "empty"
    if text.startswith("[") or text.startswith("{"):
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get("items", [data])
        items = []
        for d in data:
            if isinstance(d, dict) and d.get("title"):
                items.append(_norm_manual_item(d))
        return items, "json"

    if text.startswith("##") or re.match(r"^#\s+\S", text):
        items = []
        for block in re.split(r"\n#{2,3}\s+", text):
            block = block.strip()
            if not block:
                continue
            if block.startswith("#"):  # 首块仍带 ## 前缀
                block = re.sub(r"^#{1,6}\s+", "", block)
            fields = {"title": ""}
            lines = block.strip().splitlines()
            if lines and not re.match(r"^\S+:\s*", lines[0]):
                fields["title"] = lines[0].strip()
            for ln in lines:
                m = re.match(r"^([^:：]{1,12})[:：]\s*(.+)$", ln.strip())
                if not m:
                    continue
                key = _HEADER_MAP.get(m.group(1).strip().lower(), m.group(1).strip().lower())
                fields[key] = m.group(2).strip()
            if fields.get("title"):
                items.append(_norm_manual_item(fields))
        return items, "md"

    # CSV：首行表头
    rows = list(csv.DictReader(io.StringIO(text)))
    items = []
    for row in rows:
        fields = {}
        for k, v in row.items():
            if k is None:
                continue
            key = _HEADER_MAP.get(k.strip().lower(), k.strip().lower())
            fields[key] = (v or "").strip()
        if fields.get("title"):
            items.append(_norm_manual_item(fields))
    return items, ("csv" if items else "unknown")


def _norm_manual_item(d: dict) -> dict:
    tags = d.get("tags")
    if isinstance(tags, str):
        tags = [t for t in re.split(r"[/、;；,，|\s]+", tags) if t][:8]
    title = str(d.get("title") or "").strip()
    genre = str(d.get("genre") or "自由导入").strip()
    logline = str(d.get("logline") or "").strip()
    return normalize_item({
        "id": f"manual-{hashlib.md5(title.encode('utf-8')).hexdigest()[:12]}",
        "title": title,
        "genre": genre,
        "platform": str(d.get("platform") or "人工导入").strip(),
        "heat": 90.0,
        "episodes": 0,
        "author": str(d.get("author") or "").strip(),
        "logline": logline or f"人工导入语料 · {genre}",
        "hook": str(d.get("hook") or "").strip() or (logline.split("。")[0][:60] if logline else ""),
        "beats": d.get("beats") or [],
        "reversal": str(d.get("reversal") or "").strip(),
        "pay_card": "",
        "golden_lines": d.get("golden_lines") or [],
        "lessons": [],
        "tags": tags or [genre],
        "source_url": "",
        "_live": False,
        "_manual": True,
    }, market=d.get("market"), content_type=d.get("content_type"), source_type="manual")


def merge_manual_items(items: list[dict]) -> dict:
    """合并人工导入条目到 corpus_manual.json（新覆盖同 id 旧条目）"""
    payload = _load(MANUAL)
    merged = _dedupe(list(items) + list(payload.get("items", [])))
    _save(MANUAL, {"items": merged}, f"人工导入 {len(merged)} 条")
    return {"ok": True, "imported": len(items), "total": len(merged)}


# ---------------- LLM 深加工 ----------------

def _entry_lines(items: list[dict]) -> str:
    lines = []
    for i, it in enumerate(items, 1):
        intro = (it.get("logline") or it.get("hook") or "")[:150]
        lines.append(f"[{i}] 《{it['title']}》 {it.get('genre', '')} | {intro}")
    return "\n".join(lines)


async def polish(limit: int = 20) -> dict:
    """LLM 批量补全 corpus_live.json 中未加工条目（按 heat 降序取 limit 条）"""
    t0 = time.time()
    payload = _load(LIVE)
    items = payload.get("items", [])
    todo = [it for it in items if not it.get("_polished") and (it.get("logline") or it.get("hook"))]
    todo.sort(key=lambda x: x.get("heat", 0), reverse=True)
    todo = todo[: max(1, min(int(limit), 60))]

    polished, failed, idx_map = 0, 0, {it["id"]: it for it in items}
    for s in range(0, len(todo), POLISH_BATCH):
        batch = todo[s : s + POLISH_BATCH]
        prompt = _PROMPT.format(n=len(batch), entries=_entry_lines(batch))
        r = await llm.chat_json(
            [{"role": "user", "content": prompt}], temperature=0.6, max_tokens=3000)
        if not isinstance(r, list):
            failed += len(batch)
            continue
        by_n = {x.get("n"): x for x in r if isinstance(x, dict)}
        for i, src in enumerate(batch, 1):
            out = by_n.get(i)
            if not out:
                failed += 1
                continue
            dst = idx_map[src["id"]]
            if out.get("hook"):
                dst["hook"] = str(out["hook"])[:80]
            if out.get("reversal"):
                dst["reversal"] = str(out["reversal"])[:100]
            if isinstance(out.get("golden_lines"), list) and out["golden_lines"]:
                dst["golden_lines"] = [str(x)[:60] for x in out["golden_lines"]][:3]
            if isinstance(out.get("beats"), list) and out["beats"]:
                dst["beats"] = [str(x)[:30] for x in out["beats"]][:6]
            dst["_polished"] = True
            polished += 1

    if polished:
        _save(LIVE, payload, payload.get("source") or "深加工更新")
    return {"ok": True, "polished": polished, "failed": failed,
            "remaining": sum(1 for it in items if not it.get("_polished")),
            "elapsed_s": round(time.time() - t0, 1)}
