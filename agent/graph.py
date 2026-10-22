# -*- coding: utf-8 -*-
"""模块2：知识图谱 — JSON 存储 + 内存索引 + 关联度算法 + 路径回溯 + 质量指标

数据模型（data/graph.json）：
  实体：{id: "{type}:{slug}", type, name, props, category_ids, confidence, review}
  关系：{src, dst, rel, weight, evidence, confidence}
实体类型：drama/hook/trope/theme/emotion/style/structure
关系类型：uses/adopts/belongs_to/similar/pairs_with/adapted_from
"""
import json
import re
import threading
from collections import Counter, defaultdict, deque
from datetime import datetime
from pathlib import Path

from .market import market_visible, normalize_market

_DATA = Path(__file__).resolve().parent.parent / "data" / "graph.json"
_LOCK = threading.RLock()

ENTITY_TYPES = ["drama", "hook", "trope", "theme", "emotion", "style", "structure"]
REL_TYPES = ["uses", "adopts", "belongs_to", "similar", "pairs_with", "adapted_from"]
TYPE_NAMES = {"drama": "剧本/剧作", "hook": "钩子", "trope": "套路桥段", "theme": "题材主题",
              "emotion": "情感", "style": "风格", "structure": "结构"}


def _load():
    if _DATA.exists():
        with open(_DATA, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"version": 1, "entities": [], "relations": [],
            "stats": {"total_entities": 0, "total_relations": 0, "last_extract_at": None}}


def _bigrams(text):
    """中文二元组 + 英数词（关联度文本相似用）"""
    if not text:
        return []
    out = []
    for seg in re.findall(r"[a-zA-Z0-9]+|[\u4e00-\u9fff]+", str(text)):
        if seg.isascii():
            out.append(seg.lower())
        else:
            out.extend(seg)
            out.extend(seg[i:i + 2] for i in range(len(seg) - 1))
    return out


def _cos(c1: Counter, c2: Counter):
    if not c1 or not c2:
        return 0.0
    common = set(c1) & set(c2)
    dot = sum(c1[t] * c2[t] for t in common)
    n1 = math.sqrt(sum(v * v for v in c1.values()))
    n2 = math.sqrt(sum(v * v for v in c2.values()))
    return dot / (n1 * n2) if n1 and n2 else 0.0


import math


class KnowledgeGraph:
    def __init__(self):
        self.g = _load()
        self._reindex()

    # ---------- 索引 ----------
    def _reindex(self):
        self._ents = {e["id"]: e for e in self.g["entities"]}
        self._adj = defaultdict(set)          # eid -> 邻居 eids
        self._edges = defaultdict(list)       # eid -> 关联的 relation 对象
        for r in self.g["relations"]:
            if r["src"] in self._ents and r["dst"] in self._ents:
                self._adj[r["src"]].add(r["dst"])
                self._adj[r["dst"]].add(r["src"])
                self._edges[r["src"]].append(r)
                self._edges[r["dst"]].append(r)

    def save(self):
        with _LOCK:
            self.g["stats"] = {"total_entities": len(self.g["entities"]),
                               "total_relations": len(self.g["relations"]),
                               "last_extract_at": self.g.get("stats", {}).get("last_extract_at")}
            with open(_DATA, "w", encoding="utf-8") as f:
                json.dump(self.g, f, ensure_ascii=False, indent=1)

    # ---------- 写入 ----------
    def upsert_entity(self, eid, etype, name, props=None, category_ids=None,
                      confidence=1.0, review="auto_pass", market=None):
        with _LOCK:
            e = self._ents.get(eid)
            if e:
                if props:
                    e["props"].update(props)
                if name:
                    e["name"] = name
                if category_ids:
                    e["category_ids"] = sorted(set(e["category_ids"]) | set(category_ids))
                e["confidence"] = max(float(e.get("confidence", 0)), float(confidence))
                if market and not e.get("market"):
                    e["market"] = normalize_market(market)
                return e
            e = {"id": eid, "type": etype, "name": name or eid,
                 "props": props or {}, "category_ids": category_ids or [],
                 "confidence": round(float(confidence), 2), "review": review,
                 "market": normalize_market(market) if market else "china",
                 "created_at": datetime.now().isoformat(timespec="seconds")}
            self.g["entities"].append(e)
            self._ents[eid] = e
            self._adj.setdefault(eid, set())
            return e

    def upsert_relation(self, src, dst, rel, weight=1.0, evidence="", confidence=1.0):
        with _LOCK:
            if src not in self._ents or dst not in self._ents or src == dst:
                return None
            for r in self.g["relations"]:
                if r["src"] == src and r["dst"] == dst and r["rel"] == rel:
                    r["weight"] = round(max(r["weight"], float(weight)), 2)
                    r["confidence"] = max(r["confidence"], float(confidence))
                    if evidence and evidence not in r["evidence"]:
                        r["evidence"] = (r["evidence"] + " | " + evidence)[:200]
                    return r
            r = {"src": src, "dst": dst, "rel": rel, "weight": round(float(weight), 2),
                 "evidence": str(evidence)[:200], "confidence": round(float(confidence), 2)}
            self.g["relations"].append(r)
            self._adj[src].add(dst)
            self._adj[dst].add(src)
            self._edges[src].append(r)
            self._edges[dst].append(r)
            return r

    # ---------- 查询 ----------
    def get(self, eid):
        return self._ents.get(eid)

    def neighbors(self, eid):
        """一跳邻接（悬停预览/路径高亮）"""
        out = []
        for r in self._edges.get(eid, []):
            other = r["dst"] if r["src"] == eid else r["src"]
            o = self._ents.get(other)
            if o:
                out.append({"rel": r["rel"], "weight": r["weight"],
                            "confidence": r["confidence"], "evidence": r["evidence"],
                            "dir": "out" if r["src"] == eid else "in", "node": o})
        out.sort(key=lambda x: -x["weight"])
        return out

    def overview(self, types=None, q=None, limit=300, market=""):
        """全局概览子图（Canvas 渲染数据）；market 非空时只保留该市场 + common 实体"""
        tset = set(types) if types else None
        keep = []
        for e in self.g["entities"]:
            if tset and e["type"] not in tset:
                continue
            if market and not market_visible(e, market):
                continue
            if q:
                blob = e["name"] + " " + json.dumps(e.get("props", {}), ensure_ascii=False)
                if q.lower() not in blob.lower():
                    continue
            keep.append(e)
            if len(keep) >= limit:
                break
        ids = {e["id"] for e in keep}
        links = [r for r in self.g["relations"] if r["src"] in ids and r["dst"] in ids]
        # total = 当前过滤条件（含市场）匹配到的实体总数；shown = 本次渲染数（limit 截断）
        matched = len(keep) if len(keep) < limit else sum(
            1 for e in self.g["entities"]
            if (not tset or e["type"] in tset)
            and (not market or market_visible(e, market))
            and (not q or q.lower() in (e["name"] + " " + json.dumps(e.get("props", {}), ensure_ascii=False)).lower()))
        return {"nodes": keep, "links": links,
                "total": matched, "shown": len(keep)}

    def cluster(self, market=""):
        """节点聚类：按类型分组 + 组内平均度数（market 非空时只统计该市场 + common）"""
        deg = {eid: len(s) for eid, s in self._adj.items()}
        groups = defaultdict(list)
        for e in self.g["entities"]:
            if market and not market_visible(e, market):
                continue
            groups[e["type"]].append({"id": e["id"], "name": e["name"], "deg": deg.get(e["id"], 0)})
        return [{"type": t, "name": TYPE_NAMES.get(t, t), "count": len(v),
                 "avg_degree": round(sum(x["deg"] for x in v) / len(v), 2),
                 "top_nodes": sorted(v, key=lambda x: -x["deg"])[:5]}
                for t, v in sorted(groups.items(), key=lambda kv: -len(kv[1]))]

    def path(self, src, dst, max_hops=4):
        """BFS 最短路径（溯源路径回溯）"""
        if src not in self._ents or dst not in self._ents:
            return None
        prev = {src: (None, None)}
        dist = {src: 0}
        q = deque([src])
        while q:
            cur = q.popleft()
            if cur == dst:
                break
            if dist[cur] >= max_hops:
                continue
            for nb in self._adj.get(cur, ()):
                if nb not in dist:
                    dist[nb] = dist[cur] + 1
                    rel = next((r["rel"] for r in self._edges[cur]
                                if (r["src"] == cur and r["dst"] == nb) or (r["src"] == nb and r["dst"] == cur)), "rel")
                    prev[nb] = (cur, rel)
                    q.append(nb)
        if dst not in dist:
            return None
        nodes, edges, cur = [], [], dst
        while cur:
            nodes.append(cur)
            p = prev.get(cur)
            if p and p[0]:
                edges.append({"src": p[0], "dst": cur, "rel": p[1]})
            cur = p[0] if p else None
        return {"hops": len(nodes) - 1, "nodes": [self._ents[n] for n in reversed(nodes)], "edges": edges}

    def related_dramas(self, eid, top_k=8):
        """剧本间关联度排序：0.5×文本bigram余弦 + 0.3×标签Jaccard + 0.2×钩子重叠率"""
        e = self._ents.get(eid)
        if not e:
            return []
        base_text = " ".join(str(v) for v in [e["name"], e["props"].get("logline", ""), e["props"].get("text", "")])
        base_bg = Counter(_bigrams(base_text))
        base_tags = set(e.get("category_ids", [])) | set(e["props"].get("tags", []) or [])
        base_hooks = {n for n in self._adj.get(eid, ()) if self._ents[n]["type"] == "hook"}
        base_mkt = e.get("market") or "china"
        out = []
        for o in self.g["entities"]:
            if o["id"] == eid or o["type"] != "drama":
                continue
            if base_mkt != "common" and (o.get("market") or "china") not in (base_mkt, "common"):
                continue  # 同市场内关联（日本剧不关联中国剧）
            ot = " ".join(str(v) for v in [o["name"], o["props"].get("logline", ""), o["props"].get("text", "")])
            sim = _cos(base_bg, Counter(_bigrams(ot)))
            otags = set(o.get("category_ids", [])) | set(o["props"].get("tags", []) or [])
            union = base_tags | otags
            jac = len(base_tags & otags) / len(union) if union else 0.0
            oh = {n for n in self._adj.get(o["id"], ()) if self._ents[n]["type"] == "hook"}
            hun = base_hooks | oh
            hov = len(base_hooks & oh) / len(hun) if hun else 0.0
            score = 0.5 * sim + 0.3 * jac + 0.2 * hov
            if score > 0.01:
                out.append({"id": o["id"], "name": o["name"], "props": o["props"],
                            "score": round(score, 3),
                            "breakdown": {"text": round(sim, 3), "tag": round(jac, 3), "hook": round(hov, 3)}})
        out.sort(key=lambda x: -x["score"])
        return out[:top_k]

    def quality(self, market=""):
        """数据质量指标（质量评估标准见技术方案 §4.3）

        - market 非空时只统计该站点可见实体（market==站点 或 common）及其关系，
          保证各站点看到的规模/质量数字是本站真实数据
        - accuracy 图谱数据准确率 = 已确认数据（通过质量校验，非 pending）中
          结构合法（type/name/props 完整）且（置信度≥0.85 或已审核通过）的占比；
          未通过校验的 pending 数据不入库，不计入分母
        - avg_confidence 平均置信度：全体实体 confidence 均值（抽取批次参考指标）
        - relation_complete 关系完整率 = 有 evidence 支撑的关系占比
        """
        ents, rels = self.g["entities"], self.g["relations"]
        if market:
            ents = [e for e in ents if market_visible(e, market)]
            vis = {e["id"] for e in ents}
            rels = [r for r in rels if r["src"] in vis and r["dst"] in vis]
        confirmed = [e for e in ents if e.get("review") != "pending"]
        if confirmed:
            ok = sum(1 for e in confirmed
                     if e.get("type") in TYPE_NAMES and e.get("name") and e.get("props")
                     and (float(e.get("confidence", 0)) >= 0.85
                          or e.get("review") in ("approved", "auto_pass")))
            acc = ok / len(confirmed)
        else:
            acc = 0.0
        comp = sum(1 for r in rels if r.get("evidence")) / len(rels) if rels else 0.0
        return {"entities": len(ents), "relations": len(rels),
                "accuracy": round(acc * 100, 1),
                "avg_confidence": round(sum(float(e.get("confidence", 0)) for e in ents)
                                        / len(ents) * 100, 1) if ents else 0.0,
                "relation_complete": round(comp * 100, 1),
                "pending_review": sum(1 for e in ents if e.get("review") == "pending"),
                "last_extract_at": self.g.get("stats", {}).get("last_extract_at")}


def similarity(a, b):
    """文本相似度（bigram 余弦，剧本对比用）"""
    return round(_cos(Counter(_bigrams(a)), Counter(_bigrams(b))), 3)


def diff_highlight(a, b):
    """剧本对比：字符级差异标记（⟪⟫ 包裹 a 相对 b 的独有内容，前端渲染为高亮）"""
    a = str(a or "")
    common = set(_bigrams(a)) & set(_bigrams(b))
    out = []
    for i, ch in enumerate(a):
        if ch in "\n \t":
            out.append(ch)
        elif (a[i:i + 2] in common) or (i > 0 and a[i - 1:i + 1] in common):
            out.append(ch)
        else:
            out.append("⟪" + ch + "⟫")
    return "".join(out)


_g = None


def get_graph():
    global _g
    if _g is None:
        _g = KnowledgeGraph()
    return _g


def reload_graph():
    """数据文件被外部/抽取管线重写后强制重载"""
    global _g
    _g = KnowledgeGraph()
    return _g
