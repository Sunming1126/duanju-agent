# -*- coding: utf-8 -*-
"""模块4：短剧结构模板库 — 标准结构与自定义结构的创建/管理

模板：{id, name, kind: standard|custom, description, beats:[{beat, ratio, goal, hook_mechanism}], total_episodes_hint}
"""
import json
import re
import threading
from datetime import datetime
from pathlib import Path

from .market import market_visible

_DATA = Path(__file__).resolve().parent.parent / "data" / "templates.json"
_LOCK = threading.RLock()


def _load():
    with open(_DATA, "r", encoding="utf-8") as f:
        d = json.load(f)
    for t in d.get("templates", []):
        t.setdefault("market", "china")
    return d


def _save(d):
    d["version"] = 1
    with open(_DATA, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


def list_templates(kind=None, market=""):
    with _LOCK:
        d = _load()
        tpls = d["templates"]
        if market:
            tpls = [t for t in tpls if market_visible(t, market)]
        if kind:
            tpls = [t for t in tpls if t.get("kind") == kind]
        return {"count": len(tpls), "items": tpls}


def get_template(tid):
    with _LOCK:
        for t in _load()["templates"]:
            if t["id"] == tid:
                return t
    raise ValueError(f"模板不存在: {tid}")


def _slug(s):
    return re.sub(r"[\s/\\]+", "", s or "")[:20] or "x"


def create_template(name, description="", beats=None, kind="custom", total_episodes_hint="", market="china"):
    """创建自定义结构模板；beats 比例自动归一化"""
    with _LOCK:
        d = _load()
        tid = f"tpl:custom-{_slug(name)}-{int(datetime.now().timestamp()) % 100000}"
        beats = beats or []
        total = sum(float(b.get("ratio") or 0) for b in beats) or 1.0
        norm = [{"beat": b.get("beat") or f"节拍{i+1}",
                 "ratio": round(float(b.get("ratio") or 0) / total, 3),
                 "goal": b.get("goal") or "",
                 "hook_mechanism": b.get("hook_mechanism") or []}
                for i, b in enumerate(beats)]
        t = {"id": tid, "name": name, "kind": kind, "description": description,
             "beats": norm, "total_episodes_hint": total_episodes_hint,
             "market": market,
             "created_at": datetime.now().isoformat(timespec="seconds")}
        d["templates"].append(t)
        _save(d)
        return t


def update_template(tid, name=None, description=None, beats=None, total_episodes_hint=None):
    with _LOCK:
        d = _load()
        for t in d["templates"]:
            if t["id"] == tid:
                if name is not None:
                    t["name"] = name
                if description is not None:
                    t["description"] = description
                if total_episodes_hint is not None:
                    t["total_episodes_hint"] = total_episodes_hint
                if beats:
                    total = sum(float(b.get("ratio") or 0) for b in beats) or 1.0
                    t["beats"] = [{"beat": b.get("beat") or f"节拍{i+1}",
                                   "ratio": round(float(b.get("ratio") or 0) / total, 3),
                                   "goal": b.get("goal") or "",
                                   "hook_mechanism": b.get("hook_mechanism") or []}
                                  for i, b in enumerate(beats)]
                _save(d)
                return t
        raise ValueError(f"模板不存在: {tid}")


def delete_template(tid):
    """自定义模板可删除；标准模板只允许归档语义（拒绝删除）"""
    with _LOCK:
        d = _load()
        before = len(d["templates"])
        d["templates"] = [t for t in d["templates"] if not (t["id"] == tid and t.get("kind") == "custom")]
        if len(d["templates"]) == before:
            raise ValueError(f"模板不存在或为标准模板不可删除: {tid}")
        _save(d)
        return True
