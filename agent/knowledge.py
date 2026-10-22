# -*- coding: utf-8 -*-
"""知识库检索：BM25（中文 bigram / 日文 n-gram / 英文词干）+ 字段加权 + 同义词归一化"""
import json
import math
import re
from pathlib import Path
from .market import normalize_item, market_matches

_DATA = Path(__file__).resolve().parent.parent / "data" / "corpus.json"
_LIVE_DATA = Path(__file__).resolve().parent.parent / "data" / "corpus_live.json"
_MANUAL_DATA = Path(__file__).resolve().parent.parent / "data" / "corpus_manual.json"
_k1, _b = 1.5, 0.75
JP_TERMS = ("悪役令嬢", "契約結婚", "人生やり直し", "異世界", "人生再生", "地下城",
            "溺愛", "復讐", "ざまぁ", "転生", "令嬢", "恋愛")

# 日本同义词归一化：查询与语料 token 统一映射到代表词（检索口径一致）
JP_SYNONYMS = {
    "復讐": ("復讐", "仕返し", "ざまぁ", "報復"),
    "転生": ("転生", "生まれ変わり", "やり直し", "転生したら"),
    "溺愛": ("溺愛", "一途な愛", "甘い愛"),
    "契約結婚": ("契約結婚", "偽装結婚", "政略結婚"),
    "悪役令嬢": ("悪役令嬢", "令嬢転生", "悪役"),
}
_SYNONYM_MAP = {variant: canonical
                for canonical, variants in JP_SYNONYMS.items() for variant in variants}

# 检索时各字段权重（模拟 RRF 融合前的字段加权）
FIELD_WEIGHTS = {"logline": 3.0, "hook": 2.5, "genre": 2.5, "beats": 1.5, "reversal": 1.5, "golden_lines": 1.0, "lessons": 1.0, "title": 2.0, "tags_text": 2.0}

# 可选日文形态素解析器：SudachiPy 优先，不可用时回退到字符 n-gram（agent.md 约定的降级链）
try:
    from sudachipy import dictionary as _sudachi_dict
    from sudachipy import SplitMode
    _SUDACHI = _sudachi_dict.Dictionary().create()
    def _ja_tokens(seg: str) -> list:
        toks = [m.surface() for m in _SUDACHI.tokenize(seg, SplitMode.A)]
        # 形态素之外保留整段与二元组，兼容未分词的中文式查询
        out = [seg] + [t for t in toks if len(t) >= 2]
        out.extend(seg[i:i + 2] for i in range(len(seg) - 1))
        return out
except Exception:  # noqa: F401 —— SudachiPy 未安装：n-gram 回退
    _SUDACHI = None
    def _ja_tokens(seg: str) -> list:
        out = [seg]
        out.extend(seg[i:i + 2] for i in range(len(seg) - 1))
        out.extend(seg[i:i + 3] for i in range(len(seg) - 2))
        return out

# 英文轻词干化：复数/进行时/过去式后缀剥离（无外部依赖）
_STEM_SUFFIXES = (("ies", "y"), ("ing", ""), ("ed", ""), ("es", ""), ("s", ""))


def _stem(word: str) -> str:
    if len(word) <= 3:
        return word
    for suf, rep in _STEM_SUFFIXES:
        if word.endswith(suf) and len(word) - len(suf) >= 3:
            return word[:-len(suf)] + rep
    return word


def normalize_tokens(tokens: list) -> list:
    """同义词归一化：日文变体 → 代表词（復讐/仕返し/ざまぁ → 復讐 等）"""
    return [_SYNONYM_MAP.get(t, t) for t in tokens]


def _tokenize(text):
    """按语言提供轻量 token：中文整段+二元组，日文 SudachiPy/回退 n-gram，英文单词+词干。"""
    if not text:
        return []
    tokens = []
    for seg in re.findall(r"[a-zA-Z0-9]+|[぀-ヿ㐀-鿿]+", text):
        if seg.isdigit() or seg.isascii():
            w = seg.lower()
            tokens.append(w)
            st = _stem(w)
            if st != w:
                tokens.append(st)
        else:
            # 命中的日本题材热词整词保留（保证短语级召回）
            tokens.extend(term for term in JP_TERMS if term in seg)
            tokens.extend(_ja_tokens(seg))
    return normalize_tokens(tokens)


class KnowledgeBase:
    def __init__(self):
        with open(_DATA, "r", encoding="utf-8") as f:
            self.raw = json.load(f)
        self.items = [normalize_item(it, market="china", content_type="short_drama",
                                     source_type="manual") for it in self.raw["items"]]
        # 合并实时采集语料（多源）+ 人工导入语料，按 id 去重
        self.live_meta = None
        have = {it["id"] for it in self.items}
        for path in (_LIVE_DATA, _MANUAL_DATA):
            if not path.exists():
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    extra = json.load(f)
                for it in extra.get("items", []):
                    it = normalize_item(it)
                    if it["id"] not in have:
                        self.items.append(it)
                        have.add(it["id"])
                if path is _LIVE_DATA:
                    self.live_meta = {"updated": extra.get("updated"), "source": extra.get("source"),
                                      "count": len(extra.get("items", []))}
            except Exception:
                pass
        for it in self.items:
            normalize_item(it)
            it.setdefault("tags_text", " ".join(it.get("tags", [])))
        self._build()

    def _build(self):
        self.docs = []
        df = {}
        for it in self.items:
            tf = {}
            for field, weight in FIELD_WEIGHTS.items():
                for tok in _tokenize(str(it.get(field, ""))):
                    tf[tok] = tf.get(tok, 0) + weight
            self.docs.append(tf)
            for tok in tf:
                df[tok] = df.get(tok, 0) + 1
        self.N = len(self.docs)
        self.avgdl = sum(sum(t.values()) for t in self.docs) / max(self.N, 1)
        self.idf = {t: math.log(1 + (self.N - c + 0.5) / (c + 0.5)) for t, c in df.items()}

    def search(self, query, top_k=3, pool=None, market="", locale="", content_type=""):
        """BM25 检索，返回命中条目与得分依据；pool 为候选索引子集（灵感索引多维过滤用）"""
        q_tokens = _tokenize(query)
        scores = []
        candidates = pool if pool is not None else range(len(self.docs))
        for i in candidates:
            if not market_matches(self.items[i], market, locale, content_type):
                continue
            tf = self.docs[i]
            dl = sum(tf.values())
            score = 0.0
            matched = []
            for t in set(q_tokens):
                if t in tf:
                    f = tf[t]
                    score += self.idf.get(t, 0) * f * (_k1 + 1) / (f + _k1 * (1 - _b + _b * dl / self.avgdl))
                    matched.append(t)
            scores.append((score, i, matched))
        scores.sort(key=lambda x: -x[0])
        hits = []
        for score, i, matched in scores[:top_k]:
            if score <= 0:
                continue
            it = dict(self.items[i])
            it["_score"] = round(score, 2)
            it["_matched"] = matched[:8]
            hits.append(it)
        return hits

    def beat_template(self, genre, market="", locale="", content_type=""):
        """按题材返回节拍模板（从同类高分语料归纳；优先选含节拍数据的条目）

        市场隔离：仅从匹配市场的语料归纳，禁止用中文语料充当日本题材节拍模板
        （无命中时返回空模板，由提示词层的本地化节拍兜底）。
        """
        same = [it for it in self.items if market_matches(it, market, locale, content_type)
                and any(g in genre for g in str(it["genre"]).split("/"))]
        same.sort(key=lambda x: -x.get("heat", 0))
        with_beats = [t for t in same if t.get("beats")]
        top = (with_beats or same)[:3]
        return {
            "genre": genre,
            "reference_titles": [t["title"] for t in top],
            "common_beats": top[0]["beats"] if top else [],
            "lessons": sorted({l for t in top for l in t["lessons"]})[:6],
            "golden_lines": [g for t in top for g in t["golden_lines"][:2]],
        }


_kb = None


def get_kb():
    global _kb
    if _kb is None:
        _kb = KnowledgeBase()
    return _kb


def reset_kb():
    """采集新语料后重建知识库"""
    global _kb
    _kb = None
