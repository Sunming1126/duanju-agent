# -*- coding: utf-8 -*-
"""每日知识更新管线：采集 → 归档旧版 → 深加工 → 抽取去重入库 → 灵感库重建 → 校验 → 运行报告

版本策略（对应用户需求）：
- 知识图谱：每次更新前自动归档旧版到 data/archive/{run_id}/graph.json（可随时回看对比）
- 钩子库：按文本去重增量入库（新钩子进 pending 审核队列），不保存旧版本
- 灵感库：每次全量重建 data/inspirations.json（基于最新知识库 + 已通过钩子库），不保留旧版本
- 每次运行产出报告 data/kb_runs/{run_id}.json，供 /api/kb/runs 读取

入口：
- run_daily_update(reason, ...) 完整管线（scheduler 每日定时 / POST /api/kb/update 手动）
- rebuild_inspirations() 仅重建灵感库（POST /api/inspirations/rebuild）
- validate_graph() 图谱一致性校验（去重 / 清悬空关系）
"""
import asyncio
import json
import re
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from . import graph as graph_mod
from .market import normalize_content_type, normalize_locale, normalize_market
from .extractor import EXTRACT_RULES

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ARCHIVE_DIR = DATA / "archive"
RUNS_DIR = DATA / "kb_runs"
INSPIRATIONS_PATHS = {"china": DATA / "inspirations_china.json",
                      "japan": DATA / "inspirations_japan.json"}
USER_INSPIRATIONS_PATH = DATA / "inspirations_user.json"  # 用户导入卡（每日重建不覆盖）
LEGACY_INSPIRATIONS_PATH = DATA / "inspirations.json"     # 旧版单文件（只读兼容）


def _insp_path(market: str) -> Path:
    return INSPIRATIONS_PATHS.get(normalize_market(market) if market else "china",
                                  INSPIRATIONS_PATHS["china"])

INSPIRE_MAX = 24  # 灵感库容量（每次全量重建）

_STATE = {"running": False, "last_report": None}
_LOCK = threading.Lock()


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------------- ① 旧版归档（仅知识图谱） ----------------

def archive_graph(reason: str) -> dict:
    """更新前把当前知识图谱快照归档到 data/archive/{run_id}/，返回归档元信息"""
    src = DATA / "graph.json"
    if not src.exists():
        return {"skipped": "尚无旧版图谱"}
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    dst_dir = ARCHIVE_DIR / run_id
    dst_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst_dir / "graph.json")
    old = _read_json(dst_dir / "graph.json", {})
    meta = {
        "run_id": run_id,
        "archived_at": datetime.now().isoformat(timespec="seconds"),
        "reason": reason,
        "entities": len(old.get("entities", [])),
        "relations": len(old.get("relations", [])),
        "last_extract_at": (old.get("stats") or {}).get("last_extract_at"),
    }
    _write_json(dst_dir / "meta.json", meta)
    return meta


def list_archive() -> dict:
    """归档版本列表（倒序），供前端下拉选择查看旧版图谱"""
    out = []
    if ARCHIVE_DIR.is_dir():
        for d in sorted(ARCHIVE_DIR.iterdir(), reverse=True):
            if not d.is_dir():
                continue
            meta = _read_json(d / "meta.json", None)
            if not meta:
                continue
            out.append(meta)
    return {"count": len(out), "items": out}


def archive_overview(run_id: str, limit: int = 300):
    """读取旧版图谱并生成与 /api/graph 同构的 overview 数据（前端画布直接渲染）"""
    d = ARCHIVE_DIR / run_id
    if not d.is_dir():
        return None
    meta = _read_json(d / "meta.json", {})
    g = _read_json(d / "graph.json", None)
    if g is None:
        return None
    ents, rels = g.get("entities", []), g.get("relations", [])
    deg = {}
    for r in rels:
        deg[r["src"]] = deg.get(r["src"], 0) + 1
        deg[r["dst"]] = deg.get(r["dst"], 0) + 1
    keep = sorted(ents, key=lambda e: -deg.get(e["id"], 0))[: max(1, min(int(limit), 600))]
    ids = {e["id"] for e in keep}
    links = [r for r in rels if r["src"] in ids and r["dst"] in ids]
    return {"meta": meta, "nodes": keep, "links": links,
            "total": len(ents), "shown": len(keep), "type_names": graph_mod.TYPE_NAMES}


# ---------------- ② 图谱一致性校验（去重 + 修复） ----------------

def validate_graph() -> dict:
    """入库后校验：空名/坏类型/同名同类型重复实体清理，悬空/非法关系清理，权重夹取"""
    g = graph_mod.get_graph()
    issues = {"removed_empty_name": 0, "removed_bad_type": 0,
              "removed_duplicate": 0, "removed_dangling_rel": 0}
    seen_key, drop = {}, set()
    for e in list(g.g["entities"]):
        eid = e.get("id")
        if not str(e.get("name") or "").strip():
            drop.add(eid)
            issues["removed_empty_name"] += 1
            continue
        if e.get("type") not in graph_mod.TYPE_NAMES:
            drop.add(eid)
            issues["removed_bad_type"] += 1
            continue
        key = (e["type"], e["name"])
        if key in seen_key:  # 同名同类型重复：保留先入库的，后续删除（关系随悬空清理一并移除）
            drop.add(eid)
            issues["removed_duplicate"] += 1
        else:
            seen_key[key] = eid
    if drop:
        g.g["entities"] = [e for e in g.g["entities"] if e["id"] not in drop]

    ids = {e["id"] for e in g.g["entities"]}
    rels = []
    for r in g.g["relations"]:
        if r.get("src") not in ids or r.get("dst") not in ids or r.get("src") == r.get("dst") \
                or r.get("rel") not in graph_mod.REL_TYPES:
            issues["removed_dangling_rel"] += 1
            continue
        try:
            r["weight"] = round(min(max(float(r.get("weight", 1.0)), 0.0), 5.0), 2)
        except Exception:
            r["weight"] = 1.0
        rels.append(r)
    if drop or issues["removed_dangling_rel"]:
        g.g["relations"] = rels
        g._reindex()
        g.save()
    q = g.quality()
    return {"ok": True, **issues,
            "entities": q["entities"], "relations": q["relations"],
            "accuracy": q["accuracy"], "relation_complete": q["relation_complete"]}


# ---------------- ③ 灵感库全量重建（不保留旧版本） ----------------

def _guess_mechanism(text: str) -> str:
    for rule in EXTRACT_RULES["hook_patterns"]:
        if re.search(rule["pattern"], text or ""):
            return rule["mechanism"]
    return "悬念"


def uuid_hex() -> str:
    return uuid.uuid4().hex[:8]


def rebuild_inspirations(market: str = "china") -> dict:
    """基于最新知识库（热门语料）+ 已通过钩子库，全量重建指定市场灵感库并覆盖写入"""
    from .knowledge import get_kb
    from . import hooks as hooks_mod

    mkt = normalize_market(market)
    kb = get_kb()
    approved = [h for h in hooks_mod.list_hooks(status="approved", market=mkt)["items"]
                if h.get("position") == "open" and h.get("text")]
    items = [it for it in kb.items if (it.get("title") or "").strip()
             and normalize_market(it.get("market")) == mkt]
    items.sort(key=lambda x: -(x.get("heat") or 0))

    cards, seen = [], set()
    for it in items:
        title = it["title"].strip()
        if title in seen:
            continue
        seen.add(title)
        hook_text = (it.get("hook") or "").strip()
        if hook_text:
            hook = {"text": hook_text[:80], "from": "语料",
                    "mechanism": _guess_mechanism(hook_text), "intensity": 3}
        elif approved:
            h = approved[len(cards) % len(approved)]
            hook = {"text": h["text"], "from": "钩子库",
                    "mechanism": h.get("mechanism") or "悬念", "intensity": h.get("intensity") or 3}
        else:
            hook = None
        tags = [str(t) for t in (it.get("tags") or [])][:4]
        cards.append({
            "id": f"insp-{len(cards) + 1:03d}",
            "title": title,
            "genre": it.get("genre", ""),
            "platform": it.get("platform", ""),
            "market": it.get("market", "china"),
            "locale": it.get("locale", "zh-CN"),
            "content_type": it.get("content_type", "short_drama"),
            "source_platform": it.get("source_platform", ""),
            "author": it.get("author", ""),
            "heat": it.get("heat", 0),
            "emotion": tags[0] if tags else "",
            "mechanism": (hook or {}).get("mechanism", ""),
            "logline": (it.get("logline") or "")[:200],
            "open_hook": hook or {"text": "", "from": "知识库", "mechanism": "", "intensity": 0},
            "beats": [str(b) for b in (it.get("beats") or [])][:6],
            "golden_lines": [str(x) for x in (it.get("golden_lines") or [])][:2],
            "tags": tags,
            "source_id": it.get("id", ""),
            "source_url": it.get("source_url", ""),
        })
        if len(cards) >= INSPIRE_MAX:
            break

    payload = {"updated": datetime.now().isoformat(timespec="seconds"),
               "count": len(cards), "market": mkt, "cards": cards}
    _write_json(_insp_path(mkt), payload)
    return {"count": len(cards), "market": mkt, "updated": payload["updated"]}


def append_inspirations(new_cards: list[dict]) -> dict:
    """用户导入的灵感卡追加入库（data/inspirations_user.json，按 title 去重，每日重建不覆盖）"""
    d = _read_json(USER_INSPIRATIONS_PATH, {"updated": None, "count": 0, "cards": []})
    cards = d.get("cards", [])
    seen = {str(c.get("title") or "").strip() for c in cards}
    added = 0
    for raw in new_cards:
        title = str(raw.get("title") or "").strip()
        if not title or title in seen:
            continue
        seen.add(title)
        added += 1
        cards.append({
            "id": f"user-{uuid_hex()}",
            "title": title,
            "genre": str(raw.get("genre") or ""),
            "platform": str(raw.get("platform") or "导入"),
            "author": str(raw.get("author") or ""),
            "heat": raw.get("heat") or 0,
            "emotion": str(raw.get("emotion") or ""),
            "mechanism": str(raw.get("mechanism") or ""),
            "logline": str(raw.get("logline") or "")[:200],
            "open_hook": raw.get("open_hook") or {"text": "", "from": "导入", "mechanism": "", "intensity": 0},
            "beats": [str(b) for b in (raw.get("beats") or [])][:6],
            "golden_lines": [str(x) for x in (raw.get("golden_lines") or [])][:2],
            "tags": [str(t) for t in (raw.get("tags") or [])][:6],
            "source_id": str(raw.get("source_id") or ""),
            "source_url": str(raw.get("source_url") or ""),
            # 双市场字段：手动导入的灵感也按市场/语言/内容类型隔离（不被每日更新覆盖）
            "market": normalize_market(raw.get("market")),
            "locale": normalize_locale(raw.get("locale"), normalize_market(raw.get("market"))),
            "content_type": normalize_content_type(raw.get("content_type") or "inspiration"),
            "source_type": str(raw.get("source_type") or "manual"),
        })
    payload = {"updated": datetime.now().isoformat(timespec="seconds"),
               "count": len(cards), "cards": cards}
    _write_json(USER_INSPIRATIONS_PATH, payload)
    return {"added": added, "skipped": len(new_cards) - added, "total": len(cards)}


def list_inspirations(q: str = None, market: str = "") -> dict:
    """读取灵感库（用户导入卡在前 + 每日重建主库；q 关键词过滤；market 站点隔离）"""
    mkt = normalize_market(market) if market else ""
    user = _read_json(USER_INSPIRATIONS_PATH, {"updated": None, "count": 0, "cards": []})
    ucards = user.get("cards", [])
    if mkt:
        ucards = [c for c in ucards if normalize_market(c.get("market")) == mkt]
    d = _read_json(_insp_path(mkt or "china"),
                   _read_json(LEGACY_INSPIRATIONS_PATH, {"updated": None, "count": 0, "cards": []})
                   if not mkt else {"updated": None, "count": 0, "cards": []})
    cards = list(ucards) + list(d.get("cards", []))
    if q:
        qk = q.lower()
        cards = [c for c in cards
                 if qk in json.dumps(c, ensure_ascii=False).lower()]
    return {"updated": d.get("updated"), "count": len(cards), "total": d.get("count", 0),
            "user_count": len(ucards), "cards": cards}


# ---------------- ④ 完整每日管线 ----------------

def _run_summary(rep: dict) -> dict:
    return {
        "run_id": rep.get("run_id"), "reason": rep.get("reason"),
        "started_at": rep.get("started_at"), "elapsed_s": rep.get("elapsed_s"),
        "collect_ok": (rep.get("collect") or {}).get("ok"),
        "polished": (rep.get("polish") or {}).get("polished"),
        "extract_processed": (rep.get("extract") or {}).get("processed"),
        "hooks_new": (rep.get("extract") or {}).get("hooks_new"),
        "inspirations": (rep.get("inspirations") or {}).get("count"),
        "validation_ok": (rep.get("validation") or {}).get("ok"),
        "archived": bool(rep.get("archive") and not rep["archive"].get("skipped")),
    }


def _market_report(items: list[dict]) -> dict:
    """分市场报告：日本题材分布、日本短剧/小说热门标签、高质量条目数（对齐任务书日报要求）"""
    jp = [it for it in items if (it.get("market") or "china") == "japan"]

    def _tag_counts(sub, field="tags"):
        c = {}
        for it in sub:
            for t in (it.get(field) or [])[:6]:
                t = str(t).strip()
                if t:
                    c[t] = c.get(t, 0) + 1
        return sorted(c.items(), key=lambda x: -x[1])[:10]

    genre_c = {}
    for it in jp:
        g = (it.get("genre") or "その他").split("/")[0].split("-")[0].strip()
        if g:
            genre_c[g] = genre_c.get(g, 0) + 1
    return {
        "japan_count": len(jp),
        "japan_genres": sorted(genre_c.items(), key=lambda x: -x[1])[:10],
        "japan_drama_tags": _tag_counts([it for it in jp if it.get("content_type") == "short_drama"]),
        "japan_novel_tags": _tag_counts([it for it in jp if it.get("content_type") in ("novel", "manga")]),
        "high_quality": sum(1 for it in jp
                            if (it.get("logline") or it.get("hook"))
                            and (it.get("tags") or it.get("genre"))),
        "china_count": sum(1 for it in items if (it.get("market") or "china") == "china"),
    }


def run_daily_update(reason: str = "manual", polish_limit: int = 8,
                     extract_limit: int = 15, use_llm: bool = True,
                     market: str = "all") -> dict:
    """完整每日知识更新管线。线程安全（同时只允许一个更新任务）。

    market="all" 全量采集；"china"/"japan" 分市场运行（只采集对应市场源，
    其它市场数据在 corpus_live.json 中保留不动）。
    ① 归档旧版图谱 → ② 采集最新榜单 → ③ LLM 深加工语料（可选）
    → ④ 重建知识库 + 增量抽取去重入库（图谱 + 钩子 pending 队列）
    → ⑤ 灵感库全量重建 → ⑥ 图谱校验 → ⑦ 报告落盘
    """
    with _LOCK:
        if _STATE["running"]:
            return {"ok": False, "msg": "已有更新任务进行中，请稍后再试"}
        _STATE["running"] = True
    t0 = time.time()
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    rep = {"run_id": run_id, "reason": reason, "use_llm": bool(use_llm), "market": market,
           "started_at": datetime.now().isoformat(timespec="seconds")}
    try:
        # ① 归档旧版（含旧图谱规模，供对比）
        try:
            rep["archive"] = archive_graph(reason)
        except Exception as e:
            rep["archive"] = {"error": str(e)}

        # ② 采集（market=japan/china 时只跑对应市场源，其它市场数据保留）
        try:
            from . import collector
            c = collector.collect(market=None if market in ("", "all") else market)
            rep["collect"] = {"ok": bool(c.get("ok")), "count": c.get("count", 0),
                              "sources": [s.get("source", s.get("error", "?"))
                                          for s in (c.get("sources") or [])],
                              "source_details": [
                                  {"source": s.get("source"), "ok": bool(s.get("ok")),
                                   "count": len(s.get("items") or []),
                                   "error": s.get("error")}
                                  for s in (c.get("sources") or [])],
                              "elapsed_s": c.get("elapsed_s")}
            # 按市场和内容类型保存统计，便于日报直接区分中日双库。
            try:
                collected = c.get("items") or []
                if not collected:
                    live_path = Path(__file__).resolve().parent.parent / "data" / "corpus_live.json"
                    collected = (_read_json(live_path, {}) or {}).get("items", [])
                market_counts, type_counts = {}, {}
                for item in collected:
                    m = item.get("market", "china")
                    t = item.get("content_type", "short_drama")
                    market_counts[m] = market_counts.get(m, 0) + 1
                    type_counts[t] = type_counts.get(t, 0) + 1
                rep["collect"]["market_counts"] = market_counts
                rep["collect"]["content_type_counts"] = type_counts
                rep["collect"]["market_report"] = _market_report(collected)
            except Exception:
                pass
        except Exception as e:
            rep["collect"] = {"ok": False, "error": str(e)}

        # ③ LLM 深加工（best effort，失败不阻断）
        if use_llm:
            try:
                from . import polish as polish_mod
                rep["polish"] = asyncio.run(polish_mod.polish(limit=max(0, min(int(polish_limit), 60))))
            except Exception as e:
                rep["polish"] = {"error": str(e)}
        else:
            rep["polish"] = {"skipped": True}

        # ④ 重建知识库 + 增量抽取（抽取内置 id 去重 + 钩子 text 去重）
        try:
            from .knowledge import reset_kb
            from .extractor import run_extract
            reset_kb()
            rep["extract"] = asyncio.run(run_extract(
                limit=max(1, min(int(extract_limit), 60)), use_llm=bool(use_llm)))
        except Exception as e:
            rep["extract"] = {"error": str(e)}

        # ⑤ 灵感库全量重建（分市场；不保留旧版本）
        try:
            mkt = str(market or "all").strip().lower()
            insp_markets = ["china", "japan"] if mkt in ("all", "global", "") else [normalize_market(mkt)]
            insp_res = {}
            for mk in insp_markets:
                try:
                    insp_res[mk] = rebuild_inspirations(mk).get("count")
                except Exception as ie:
                    insp_res[mk] = f"err: {ie}"
            rep["inspirations"] = insp_res
        except Exception as e:
            rep["inspirations"] = {"error": str(e)}

        # ⑥ 图谱校验（去重/悬空清理/权重夹取）
        try:
            rep["validation"] = validate_graph()
        except Exception as e:
            rep["validation"] = {"ok": False, "error": str(e)}

        # ⑦ 报告
        rep["finished_at"] = datetime.now().isoformat(timespec="seconds")
        rep["elapsed_s"] = round(time.time() - t0, 1)
        rep["ok"] = True
    except Exception as e:
        rep["ok"] = False
        rep["error"] = str(e)
        rep["elapsed_s"] = round(time.time() - t0, 1)
    finally:
        _write_json(RUNS_DIR / f"{run_id}.json", rep)
        _STATE["running"] = False
        _STATE["last_report"] = _run_summary(rep)
    return rep


def list_runs(limit: int = 30) -> dict:
    out = []
    if RUNS_DIR.is_dir():
        for p in sorted(RUNS_DIR.glob("*.json"), reverse=True):
            if p.stem.startswith("_"):
                continue
            d = _read_json(p, {})
            if not d.get("run_id"):
                continue
            out.append(_run_summary(d))
            if len(out) >= max(1, min(int(limit), 100)):
                break
    return {"count": len(out), "runs": out}


def get_run(run_id: str):
    p = RUNS_DIR / f"{run_id}.json"
    if not p.exists() or run_id.startswith("_"):
        return None
    return _read_json(p, None)


def status() -> dict:
    """运行状态（/api/kb/status 轮询用）"""
    return {"running": _STATE["running"], "last_report": _STATE["last_report"]}
