# -*- coding: utf-8 -*-
"""模块1：平台类别扩展 — 4 维度分类体系 + 关联机制 + 管理后台（动态添加/编辑/归档）

数据结构（data/categories.json）：
  dimensions: [{key, name, description}]
  categories: [{id: "{dim}:{slug}", dimension, name, features, data_source, related_ids, archived}]
关联机制：related_ids 双向引用 + resolve_ids 名称/ID 模糊解析
"""
import json
import re
import threading
from datetime import datetime
from pathlib import Path

from .market import market_visible
from .localization import JP_GENRES

_DATA = Path(__file__).resolve().parent.parent / "data" / "categories.json"
_LOCK = threading.RLock()


def _load():
    with open(_DATA, "r", encoding="utf-8") as f:
        d = json.load(f)
    for c in d.get("categories", []):
        c.setdefault("market", "china")  # 历史类别体系来自中文钩子库，缺省归中国市场
    known = {c.get("id") for c in d.get("categories", [])}
    for i, genre in enumerate(JP_GENRES):
        cid = f"genre:jp-{i + 1}"
        if cid not in known:
            d.setdefault("categories", []).append({"id": cid, "dimension": "genre", "name": genre,
                "features": "", "data_source": "日本市場の創作分類（編集用）", "related_ids": [],
                "archived": False, "market": "japan"})
    return d


def _save(d):
    d["updated"] = datetime.now().isoformat(timespec="seconds")
    with open(_DATA, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)


def list_categories(dimension=None, include_archived=True, market=""):
    """类别树：维度 + 类别列表（支持按维度/市场过滤、归档过滤）"""
    with _LOCK:
        d = _load()
        cats = d["categories"]
        if market:
            cats = [c for c in cats if market_visible(c, market)]
        if not include_archived:
            cats = [c for c in cats if not c.get("archived")]
        if dimension:
            cats = [c for c in cats if c.get("dimension") == dimension]
        return {"schema_version": d.get("schema_version", 1),
                "dimensions": d["dimensions"],
                "categories": cats}


def get_category(cid: str):
    """按 id 取单条类别（详情接口跨市场校验用），不存在返回 None"""
    with _LOCK:
        for c in _load().get("categories", []):
            if c.get("id") == cid:
                return c
    return None


def _slug(name):
    return re.sub(r"[\s/\\]+", "", name or "")[:24] or "x"


def add_category(dimension, name, features="", data_source="", related_ids=None, market="china"):
    """动态添加类别（数据接口规范：id = {dimension}:{slug}）"""
    with _LOCK:
        d = _load()
        if not any(dim["key"] == dimension for dim in d["dimensions"]):
            raise ValueError(f"未知维度: {dimension}")
        cid = f"{dimension}:{_slug(name)}"
        if any(c["id"] == cid for c in d["categories"]):
            raise ValueError(f"类别已存在: {cid}")
        cat = {"id": cid, "dimension": dimension, "name": name, "features": features,
               "data_source": data_source, "related_ids": related_ids or [], "archived": False,
               "market": market}
        d["categories"].append(cat)
        _save(d)
        _sync_related(d, cat)
        return cat


def _sync_related(d, cat):
    """关联机制：related_ids 双向补全"""
    for rid in cat.get("related_ids", []):
        for c in d["categories"]:
            if c["id"] == rid and cat["id"] not in c["related_ids"]:
                c["related_ids"].append(cat["id"])
    _save(d)


def update_category(cid, name=None, features=None, data_source=None, related_ids=None):
    """编辑类别（含关联关系更新）"""
    with _LOCK:
        d = _load()
        for c in d["categories"]:
            if c["id"] == cid:
                if name is not None:
                    c["name"] = name
                if features is not None:
                    c["features"] = features
                if data_source is not None:
                    c["data_source"] = data_source
                if related_ids is not None:
                    c["related_ids"] = [r for r in related_ids if r != cid]
                    _sync_related(d, c)
                else:
                    _save(d)
                return c
        raise ValueError(f"类别不存在: {cid}")


def archive_category(cid, archived=True):
    """归档/恢复类别（归档后不出现在默认列表，但保留历史引用完整性）"""
    with _LOCK:
        d = _load()
        for c in d["categories"]:
            if c["id"] == cid:
                c["archived"] = bool(archived)
                _save(d)
                return c
        raise ValueError(f"类别不存在: {cid}")


def resolve_ids(names):
    """类别关联解析：名称/ID 模糊匹配 → 类别 id 列表（供图谱与语料挂接类别）"""
    with _LOCK:
        d = _load()
        ids = []
        for n in names or []:
            n = str(n).strip()
            if not n:
                continue
            for c in d["categories"]:
                if c["archived"]:
                    continue
                if n == c["id"] or n == c["name"] or (n and n in c["name"]):
                    if c["id"] not in ids:
                        ids.append(c["id"])
        return ids
