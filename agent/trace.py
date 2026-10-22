# -*- coding: utf-8 -*-
"""模块3：剧本生成溯源 — 记录生成过程中引用的知识节点/权重/路径，并注册进知识图谱

trace 结构：{trace_id, created_at, req, steps:[{node,status,data}], citations:[{source_id,title,weight,fields}], drama_eid}
"""
import json
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path

from . import graph as graph_mod

_DATA = Path(__file__).resolve().parent.parent / "data" / "traces.json"
_LOCK = threading.RLock()


def _load():
    if _DATA.exists():
        with open(_DATA, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"version": 1, "traces": []}


def _save(d):
    with open(_DATA, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


def record(req, steps, hits):
    """生成完成后的溯源登记：
    1. kb_search 命中归一化为 citations（weight = score/max_score）
    2. 本次生成注册为 drama 实体，与引用来源建立 adapted_from 关系（路径回溯依据）
    """
    with _LOCK:
        d = _load()
        ts = datetime.now()
        tid = f"trace:{ts.strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4]}"

        max_s = max((h.get("_score", 0) for h in hits), default=0) or 1.0
        citations = [{"source_id": h["id"], "title": h.get("title", ""),
                      "weight": round(h.get("_score", 0) / max_s, 3),
                      "genre": h.get("genre", ""), "hook": (h.get("hook") or "")[:50],
                      "matched": h.get("_matched", [])[:8]} for h in hits]

        logline = (req.get("idea") or "未命名生成")[:40]
        eid = f"drama:gen-{ts.strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4]}"
        g = graph_mod.get_graph()
        g.upsert_entity(eid, "drama", logline,
                        props={"logline": logline, "genre": req.get("genre", ""),
                               "hero": req.get("hero", ""), "generated": True,
                               "trace_id": tid, "tags": [req.get("genre", "")],
                               "brief": f"AI 生成剧：{logline}（题材：{req.get('genre','')}）"},
                        category_ids=[], confidence=0.9, review="auto_pass",
                        market=req.get("market") or "china")
        for c in citations:
            # adapted_from：生成剧 ← 语料来源（溯源核心关系）
            g.upsert_relation(eid, f"drama:{c['source_id']}", "adapted_from",
                              weight=c["weight"],
                              evidence=f"生成时检索命中 score={c['weight']}", confidence=1.0)
        g.save()

        tr = {"trace_id": tid, "created_at": ts.isoformat(timespec="seconds"),
              "req": req, "steps": steps, "citations": citations, "drama_eid": eid}
        d["traces"].insert(0, tr)
        d["traces"] = d["traces"][:50]  # 保留最近50条
        _save(d)
        return tr


def list_traces():
    with _LOCK:
        d = _load()
        return {"count": len(d["traces"]),
                "items": [{k: v for k, v in t.items() if k != "steps"} for t in d["traces"]]}


def get_trace(tid):
    """溯源详情：步骤 + 引用节点 + 图谱路径回溯（生成剧 → 引用语料）"""
    with _LOCK:
        for t in _load()["traces"]:
            if t["trace_id"] == tid:
                g = graph_mod.get_graph()
                paths = []
                for c in t.get("citations", []):
                    p = g.path(t["drama_eid"], f"drama:{c['source_id']}")
                    if p:
                        paths.append({"source": c["title"], "hops": p["hops"],
                                      "nodes": [n["id"] for n in p["nodes"]],
                                      "edges": p["edges"]})
                out = dict(t)
                out["graph_paths"] = paths
                node = g.get(t.get("drama_eid"))
                out["drama_node"] = node
                return out
    raise ValueError(f"溯源记录不存在: {tid}")
