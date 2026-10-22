# -*- coding: utf-8 -*-
"""模块2+4：大模型知识抽取管线

流程：规则引擎预抽 → LLM 补充抽取(JSON schema 约束) → 合并去重 → 质量校验(置信度<0.6入审核) → 落库 graph.json + hooks.json
质量标准：规则来源 confidence=1.0；LLM 来源 confidence=0.75；<0.6 → review=pending（人工审核队列）
抽取规则可自定义：EXTRACT_RULES 支持运行时扩展（/api/hooks/extract 规则迭代）
"""
import asyncio
import json
import re
import threading
from datetime import datetime
from pathlib import Path

from . import llm
from . import hooks as hooks_mod
from . import categories as cats_mod
from . import graph as graph_mod
from .knowledge import get_kb

_LOCK = threading.RLock()

# ---------- 可自定义的抽取规则（运行时可扩展/优化迭代） ----------
EXTRACT_RULES = {
    # 钩子五类识别规则（详见 docs/00_research_shortdrama_theory.md）——中文 + 日文双语
    "hook_patterns": [
        {"category": "金句钩", "mechanism": "金句", "pattern": r"(恭迎|回归|跪|求|不过如此|从今天起|三日|十年|万年)"},
        {"category": "危机钩", "mechanism": "危机", "pattern": r"(失灵|只剩|倒计时|来不及|最后一|爆炸|生死)"},
        {"category": "期待钩", "mechanism": "期待", "pattern": r"(下山|归来|即将|马上就要|只差一步|终于要)"},
        {"category": "标题钩", "mechanism": "悬念", "pattern": r"(我都.{1,6}了|你让我|竟然让我|居然要)"},
        {"category": "悬念钩", "mechanism": "悬念", "pattern": r"(谁|为什么|到底|究竟|不可能|假的|真相|秘密|身份)"},
        {"category": "反转钩", "mechanism": "反差", "pattern": r"(没想到|谁知|竟然|居然|下一秒|反转)"},
        # ---- 日文钩子模式（日本语料抽取主引擎） ----
        {"category": "危机钩", "mechanism": "危机", "pattern": r"(追い詰め|絶体絶命|残り[0-9０-９]|あと[0-9０-９]|失脚|断たれ|取り返しのつか|命懸け|命がけ|追放され)"},  # noqa
        {"category": "期待钩", "mechanism": "期待", "pattern": r"(ついに|いよいよ|再起|逆転[しすれ]?|やり直し[せる]?|始まる|掴む|つかむ|復讐を)"},
        {"category": "悬念钩", "mechanism": "悬念", "pattern": r"(秘密|なぜ|何故|誰[かもが]|本当は|隠さ|隠され|決して|正体|仮面|偽り|黒幕|真相|謎)"},  # noqa
        {"category": "反转钩", "mechanism": "反差", "pattern": r"(まさか|実は|気がつけば|気づいた|なんと|にもかかわらず|のに[、。]|される側| was 立場が逆転)"},  # noqa
        {"category": "金句钩", "mechanism": "金句", "pattern": r"(「[^」]{6,20}」|俺は|私は[^、。]{2,8}ない|〜ものか|許さない|見ていろ)"},
    ],
    # 情感词表 → emotion 实体（中文 + 日文）
    "emotion_words": ["爽", "虐", "甜", "燃", "治愈", "愤怒", "委屈", "解气", "心疼", "期待", "紧张",
                      "ハッピーエンド", "ほのぼの", "シリアス", "溺愛", "ざまぁ", "ハーレム", "感動",
                      "恋愛", "友情", "家族", "成長", "感動", "胸熱"],
    # 套路关键词 → trope 实体（中文 + 日文网文高频套路）
    "trope_words": ["打脸", "逆袭", "马甲", "赘婿", "重生", "穿越", "归来", "退婚", "战神", "神医",
                    "萌宝", "闪婚", "追妻", "虐渣", "曝光", "摊牌",
                    "悪役令嬢", "婚約破棄", "断罪", "ざまぁ", "転生", "転移", "追放", "すり替え",
                    "溺愛", "逆転", "復讐", "隠し子", "身代わり", "婚約者", "令嬢", "御曹司",
                    "チート", "スキル", "ステータス", "ダンジョン", "スローライフ", "パン屋",
                    "ギルド", "冒険者", "最強", "無自覚", "勘違い", "ヒロイン", "乙女ゲーム",
                    "異世界", "やり直し", "攻略", "聖女", "騎士", "王子", "公爵", "伯爵"],
}

# 处理进度（防止重复抽取语料）
_PROGRESS_PATH = Path(__file__).resolve().parent.parent / "data" / "extract_progress.json"


def _load_progress():
    if _PROGRESS_PATH.exists():
        try:
            return json.loads(_PROGRESS_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {"done": []}
    return {"done": []}


def _save_progress(p):
    _PROGRESS_PATH.write_text(json.dumps(p, ensure_ascii=False, indent=1), encoding="utf-8")


def _slug(s):
    return re.sub(r"[\s/\\]+", "", s or "")[:20] or "x"


def _classify_hook(text: str):
    """钩子句分类：命中双语 hook_patterns 返回 (category, mechanism)，否则 None"""
    for rule in EXTRACT_RULES["hook_patterns"]:
        if re.search(rule["pattern"], text or ""):
            return rule["category"], rule["mechanism"]
    return None


def rule_extract(it):
    """规则引擎预抽：从语料结构化字段直接映射实体与关系（零成本、高置信）"""
    ents, rels = [], []
    cid = f"drama:{it['id']}"
    tags = it.get("tags", []) or []

    # 1. drama 主实体（剧本实际内容 + 标准化简介 + 多级标签）
    ents.append({"id": cid, "type": "drama", "name": it["title"],
                 "props": {"logline": it.get("logline", ""), "genre": it.get("genre", ""),
                           "hook": it.get("hook", ""), "reversal": it.get("reversal", ""),
                           "beats": it.get("beats", []), "golden_lines": it.get("golden_lines", []),
                           "tags": tags, "heat": it.get("heat", 0), "source": it.get("source", "manual"),
                           "brief": f"《{it['title']}》：{(it.get('logline') or '')[:60]}（题材：{it.get('genre','')}；热度：{it.get('heat','-')}）"},
                 "category_ids": cats_mod.resolve_ids([(it.get("genre") or "").split("/")[0]]),
                 "confidence": 1.0, "review": "auto_pass"})

    # 2. genre → theme 实体 + belongs_to
    genre = (it.get("genre") or "").split("/")[0].strip()
    if genre:
        ents.append({"id": f"theme:{_slug(genre)}", "type": "theme", "name": genre,
                     "props": {"desc": f"题材类型：{genre}"}, "category_ids": cats_mod.resolve_ids([genre]),
                     "confidence": 1.0, "review": "auto_pass"})
        rels.append({"src": cid, "dst": f"theme:{_slug(genre)}", "rel": "belongs_to",
                     "weight": 1.0, "evidence": f"语料 genre={it.get('genre')}", "confidence": 1.0})

    # 3. hook 字段 → hook 实体 + uses（钩子识别规则打标）
    hook_text = (it.get("hook") or "").strip()
    if hook_text:
        cat, mech = _classify_hook(hook_text) or ("悬念钩", "悬念")  # 未命中规则按默认分类
        ents.append({"id": f"hook:{_slug(hook_text[:16])}", "type": "hook", "name": hook_text[:24],
                     "props": {"text": hook_text, "category": cat, "mechanism": mech,
                               "position": "open", "intensity": 3, "tags": tags[:3]},
                     "confidence": 0.9, "review": "auto_pass"})
        rels.append({"src": cid, "dst": f"hook:{_slug(hook_text[:16])}", "rel": "uses",
                     "weight": 3.0, "evidence": "语料 hook 字段", "confidence": 1.0})

    # 3b. 简介/logline 按句切分 → 句级钩子（日本语料简介长文本的补充钩子源，每条最多 2 句）
    blob = " ".join(x for x in [it.get("logline", ""), (it.get("hook") or "")] if x)
    seen_hooks = {hook_text}
    sent_count = 0
    for s in re.split(r"[。！？!?\n]+", blob):
        s = s.strip()
        if not (8 <= len(s) <= 60) or s in seen_hooks:
            continue
        hit = _classify_hook(s)
        if hit is None:
            continue
        cat, mech = hit
        seen_hooks.add(s)
        ents.append({"id": f"hook:{_slug(s[:16])}", "type": "hook", "name": s[:24],
                     "props": {"text": s, "category": cat, "mechanism": mech,
                               "position": "open", "intensity": 3, "tags": tags[:3]},
                     "confidence": 0.7, "review": "auto_pass"})
        rels.append({"src": cid, "dst": f"hook:{_slug(s[:16])}", "rel": "uses",
                     "weight": 1.5, "evidence": "简介句级钩子", "confidence": 0.8})
        sent_count += 1
        if sent_count >= 2:
            break

    # 4. tags → trope/emotion/style 实体 + adopts
    for tag in tags[:6]:
        tag = str(tag).strip()
        if not tag:
            continue
        if tag in EXTRACT_RULES["trope_words"]:
            etype = "trope"
        elif tag in EXTRACT_RULES["emotion_words"]:
            etype = "emotion"
        else:
            etype = "style"
        ents.append({"id": f"{etype}:{_slug(tag)}", "type": etype, "name": tag,
                     "props": {"desc": f"{graph_mod.TYPE_NAMES[etype]}：{tag}"},
                     "confidence": 0.95, "review": "auto_pass"})
        rels.append({"src": cid, "dst": f"{etype}:{_slug(tag)}", "rel": "adopts",
                     "weight": 0.8, "evidence": f"语料标签: {tag}", "confidence": 0.95})

    # 5. reversal + golden_lines → trope（金句/反转桥段）+ pairs_with
    for gl in (it.get("golden_lines") or [])[:2]:
        gl = str(gl).strip()[:40]
        if gl:
            ents.append({"id": f"trope:{_slug(gl[:14])}", "type": "trope", "name": gl,
                         "props": {"desc": "金句桥段", "quote": gl}, "confidence": 0.85, "review": "auto_pass"})
            rels.append({"src": cid, "dst": f"trope:{_slug(gl[:14])}", "rel": "pairs_with",
                         "weight": 0.6, "evidence": "语料金句", "confidence": 0.85})
    return ents, rels


async def llm_extract(it):
    """LLM 补充抽取：从 hook/logline/beats 文本中深挖 hook/trope/emotion（JSON schema 约束输出）"""
    prompt = (
        "你是短剧知识抽取引擎。从语料中抽取实体与关系，只输出 JSON，格式：\n"
        '{"entities":[{"type":"hook|trope|emotion|style","name":"实体名(12字内)","text":"原文片段","position":"open|mid|tail","mechanism":"悬念|危机|反差|期待|金句","intensity":1-5}],'
        '"relations":[{"src":"实体名1","dst":"实体名2","rel":"pairs_with|similar|uses","weight":0.1-1.0}]}\n'
        "要求：只抽取文本明确体现的元素，不要编造；实体名使用行业通用叫法；最多8个实体。\n"
        f"剧名：{it.get('title','')}\n题材：{it.get('genre','')}\n简介：{it.get('logline','')}\n"
        f"钩子：{it.get('hook','')}\n节拍：{json.dumps(it.get('beats',[]), ensure_ascii=False)[:200]}\n"
        f"金句：{json.dumps(it.get('golden_lines',[]), ensure_ascii=False)[:150]}"
    )
    data = await llm.chat_json([{"role": "system", "content": "只输出 JSON。"},
                                {"role": "user", "content": prompt}],
                               temperature=0.3, max_tokens=900)
    if not data or not isinstance(data, dict):
        return [], []
    ents, rels = [], []
    names = set()
    for e in (data.get("entities") or [])[:8]:
        name = str(e.get("name") or "").strip()
        etype = e.get("type") if e.get("type") in ("hook", "trope", "emotion", "style") else "trope"
        if not name or name in names:
            continue
        names.add(name)
        ents.append({"id": f"{etype}:{_slug(name)}", "type": etype, "name": name,
                     "props": {"text": (e.get("text") or "")[:80],
                               "position": e.get("position"), "mechanism": e.get("mechanism"),
                               "intensity": e.get("intensity"), "extractor": "llm"},
                     "confidence": 0.75, "review": "auto_pass"})  # 校验阶段再降级
    for r in (data.get("relations") or [])[:10]:
        s, d_, rl = str(r.get("src") or "").strip(), str(r.get("dst") or "").strip(), r.get("rel")
        if s in names and d_ in names and rl in ("pairs_with", "similar", "uses"):
            rels.append({"src": f"trope:{_slug(s)}", "dst": f"trope:{_slug(d_)}", "rel": rl,
                         "weight": float(r.get("weight") or 0.5), "evidence": "LLM抽取",
                         "confidence": 0.75})
    return ents, rels


def merge_ents(a, b):
    """合并去重：按 id 去重，props 深合并，confidence 取 max"""
    out = {e["id"]: e for e in a}
    for e in b:
        if e["id"] in out:
            out[e["id"]]["props"].update({k: v for k, v in e["props"].items() if v})
            out[e["id"]]["confidence"] = max(out[e["id"]]["confidence"], e["confidence"])
        else:
            out[e["id"]] = e
    return list(out.values())


def quality_check(ents):
    """质量校验：无证据支撑/低置信 → pending 审核队列"""
    for e in ents:
        if float(e.get("confidence", 0)) < 0.6:
            e["review"] = "pending"
    return ents


async def run_extract(limit=10, source_filter=None, use_llm=True, market_filter=""):
    """执行抽取管线：对未处理语料跑 规则+LLM → 图谱 → 钩子审核队列

    market_filter 非空时只抽取该市场语料（充实对应站点的图谱与钩子库）。
    """
    g = graph_mod.get_graph()
    kb = get_kb()
    progress = _load_progress()
    done = set(progress["done"])
    items = [it for it in kb.items if it["id"] not in done]
    if source_filter:
        items = [it for it in items if it.get("source") == source_filter]
    if market_filter:
        from .market import normalize_market
        mkt = normalize_market(market_filter)
        items = [it for it in items if (it.get("market") or "china") == mkt]
    items = items[:limit]

    stats = {"processed": 0, "entities": 0, "relations": 0, "hooks_new": 0, "llm_used": 0}
    for it in items:
        it_market = it.get("market") or "china"
        with _LOCK:
            ents, rels = rule_extract(it)
            if use_llm:
                le, lr = await llm_extract(it)
                ents = merge_ents(ents, le)
                rels.extend(lr)
                stats["llm_used"] += 1
            ents = quality_check(ents)

            # 校验关系端点存在性（关系完整率保障），缺失端点自动补
            have = {e["id"] for e in ents} | set(g._ents.keys())
            for e in ents:
                g.upsert_entity(e["id"], e["type"], e["name"], e["props"],
                                e.get("category_ids"), e["confidence"], e.get("review", "auto_pass"),
                                market=e.get("market") or it_market)
            for r in rels:
                if r["src"] in have and r["dst"] in have:
                    g.upsert_relation(r["src"], r["dst"], r["rel"], r["weight"],
                                      r.get("evidence", ""), r.get("confidence", 0.8))

            # 钩子实体 → 钩子库审核队列（供 AI agent 调用）
            hook_items = []
            for e in ents:
                if e["type"] == "hook" and e["props"].get("text"):
                    hook_items.append({"market": e.get("market") or it_market,
                                       "status": "approved" if float(e.get("confidence", 0)) >= 0.9 else "pending",
                                       "name": e["name"], "text": e["props"]["text"],
                                       "category": e["props"].get("category") or "悬念钩",
                                       "mechanism": e["props"].get("mechanism") or "悬念",
                                       "position": e["props"].get("position") or "open",
                                       "intensity": e["props"].get("intensity") or 3,
                                       "tags": e["props"].get("tags", [])[:3],
                                       "source_id": it["id"], "confidence": e["confidence"]})
            stats["hooks_new"] += len(hooks_mod.import_extracted(hook_items, market=it_market))
            stats["processed"] += 1
            done.add(it["id"])

    if items:
        g.g["stats"]["last_extract_at"] = datetime.now().isoformat(timespec="seconds")
        g.save()
        graph_mod.reload_graph()
        progress["done"] = list(done)[-2000:]  # 语料持续增长，保留足够进度防重复抽取
        _save_progress(progress)
    stats.update(g.quality())
    return stats


def extract_text_hooks(text):
    """对任意文本按识别规则抽取潜在钩子（规则模式，供 /api/hooks/extract 自定义文本）"""
    found = []
    sentences = re.split(r"[。！？!?\n]+", text or "")
    for s in sentences:
        s = s.strip()
        if not (4 <= len(s) <= 60):
            continue
        for rule in EXTRACT_RULES["hook_patterns"]:
            if re.search(rule["pattern"], s):
                found.append({"name": s[:24], "text": s, "category": rule["category"],
                              "mechanism": rule["mechanism"], "position": "open",
                              "intensity": 3, "confidence": 0.8, "extractor": "rule"})
                break
    return found[:10]
