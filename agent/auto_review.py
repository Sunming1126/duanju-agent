# -*- coding: utf-8 -*-
"""钩子自动筛选：规则查重（bigram 相似度）+ LLM 四维评审双层审核

流程：pending 钩子
  ① 规则层（零成本前置）：与已通过钩子库 + 本批次先入者做 bigram 相似度查重，
     ≥ 0.68 判同质化 → 直接 reject（防套路化雷同，孙一弘提出的核心痛点）
  ② LLM 层（豆包）：未拒者批量四维打分 —— 钩子强度 / 可拍性 / 风险度 / 新颖度
  ③ 分流：综合分 ≥80 自动 approve；60-80 留 pending 人工抽查；<60 自动 reject；
     风险分 ≥70 一票否决直接 reject（刘加奇要求的风险剔除）

评审记录写 review_note（reviewer=模型名）与 auto_score / auto_dims 字段，
人工审核（review/bulk_review）永远可覆盖，符合"人定规则、AI 干活"的紧箍咒思路。
LLM 不可用时降级为纯规则查重模式，被查对象留 pending 等人工。
"""
import json
import re
import time
from datetime import datetime

from . import hooks as hooks_mod
from . import llm

# ---------- 可调参数 ----------
DUP_THRESHOLD = 0.68   # bigram Jaccard 相似度阈值：≥ 判同质化拒收
APPROVE_SCORE = 75     # 综合分 ≥ 此值自动通过（80 过严导致大量堆积，75 分钩子已可入池）
REJECT_SCORE = 60      # 综合分 < 此值自动拒绝，中间留人工抽查
RISK_VETO = 70         # 风险分 ≥ 此值一票否决
BATCH_SIZE = 10        # 每次 LLM 评审批量


# ---------- 规则层：bigram 相似度查重 ----------

def _bigrams(text: str) -> set:
    """中文二元组 + 英文/数字词（单字太泛化，不参与）"""
    grams = set()
    for seg in re.findall(r"[\u4e00-\u9fff]+", text or ""):
        grams.update(seg[i:i + 2] for i in range(len(seg) - 1))
    grams.update(w.lower() for w in re.findall(r"[a-zA-Z0-9]+", text or ""))
    return grams


def _similarity(a: str, b: str) -> float:
    ga, gb = _bigrams(a), _bigrams(b)
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / len(ga | gb)


def _dedup_check(text, reference_texts):
    """与参照集（已通过钩子 + 批内先入者）比对，返回 (最高相似度, 撞上文本)"""
    best, hit = 0.0, None
    for t in reference_texts:
        s = _similarity(text, t)
        if s > best:
            best, hit = s, t
    return best, hit


# ---------- LLM 层：四维评审 ----------

async def _llm_review(batch):
    """批量四维评审，返回 {hid: {...scores}}；LLM 失败返回 None"""
    payload = [{"id": h["id"], "name": h["name"], "text": h["text"],
                "category": h.get("category", ""), "mechanism": h.get("mechanism", "")}
               for h in batch]
    prompt = (
        "你是短剧钩子评审专家。对以下钩子逐条四维打分（0-100 整数）：\n"
        "- hook 钩子强度：悬念/冲突是否具体，能否在前3秒抓住观众\n"
        "- filmable 可拍性：能否落地为具体可拍的画面或台词，而非抽象概念\n"
        "- risk 内容安全风险：指平台审核/下架风险，而非剧情刺激度！"
        "涉黄、渲染血腥细节、赌博吸毒、美化犯罪、价值导向违规才扣高分；"
        "正常短剧冲突（离婚、复仇、打脸、逆袭、豪门恩怨）风险应为 5-20\n"
        "- novelty 新颖度：是否套路化、与市面上常见短剧钩子雷同（越高越新颖）\n\n"
        f"钩子列表：\n{json.dumps(payload, ensure_ascii=False)}\n\n"
        '只输出 JSON：{"reviews":[{"id":"原样返回id","hook":0,"filmable":0,"risk":0,"novelty":0,'
        '"verdict":"approve或reject或manual","reason":"20字内理由"}]}'
    )
    data = await llm.chat_json(
        [
            {"role": "system", "content": "你是短剧钩子评审引擎。只输出 JSON。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        max_tokens=1800,
    )
    if not data or not isinstance(data.get("reviews"), list):
        return None
    return {r.get("id"): r for r in data["reviews"] if isinstance(r, dict) and r.get("id")}


def _composite(r: dict) -> int:
    """四维 → 综合分：强度 0.40 + 新颖 0.25 + 可拍 0.20 + 低风险 0.15"""
    try:
        return round(
            r.get("hook", 50) * 0.40 + r.get("novelty", 50) * 0.25
            + r.get("filmable", 50) * 0.20 + (100 - r.get("risk", 0)) * 0.15
        )
    except Exception:
        return 50


def _dims(r: dict) -> dict:
    return {"hook": r.get("hook"), "filmable": r.get("filmable"),
            "risk": r.get("risk"), "novelty": r.get("novelty"),
            "llm_verdict": r.get("verdict", ""), "reason": r.get("reason", "")}


# ---------- 落库 ----------

def _annotate(hid, score=None, dims=None, note="", reviewer=None):
    """保留 pending 状态，仅写入 AI 评审意见（人工抽查用）"""
    with hooks_mod._LOCK:
        d = hooks_mod._load()
        for h in d["hooks"]:
            if h["id"] == hid:
                if score is not None:
                    h["auto_score"] = score
                if dims is not None:
                    h["auto_dims"] = dims
                h["review_note"] = {"reviewer": reviewer or f"{llm.MODEL}-auto", "note": note,
                                    "at": datetime.now().isoformat(timespec="seconds")}
                hooks_mod._save(d)
                return h
        return None


# ---------- 主入口 ----------

def _route(h, r, score):
    """按当前阈值分流一条评审结果，返回 verdict。r 需含四维分。"""
    if r.get("risk", 0) >= RISK_VETO:
        verdict, score = "rejected", min(score, 50)
    elif score >= APPROVE_SCORE:
        verdict = "approved"
    elif score < REJECT_SCORE:
        verdict = "rejected"
    else:
        verdict = "manual"
    reason = r.get("reason", "")
    note = (f"四维 H{r.get('hook')}/F{r.get('filmable')}/R{r.get('risk')}/"
            f"N{r.get('novelty')} 综合{score}：{reason}")
    if verdict == "approved":
        hooks_mod.review_hook(h["id"], True, reviewer=f"{llm.MODEL}-auto", note=note)
        _annotate(h["id"], score=score, dims=_dims(r), note=note)
    elif verdict == "rejected":
        hooks_mod.review_hook(h["id"], False, reviewer=f"{llm.MODEL}-auto", note=note)
        _annotate(h["id"], score=score, dims=_dims(r), note=note)
    else:
        _annotate(h["id"], score=score, dims=_dims(r), note=note)
    return verdict


async def auto_review(ids=None, batch_size=BATCH_SIZE):
    """钩子自动筛选主入口：规则查重 + LLM 四维评审 + 阈值分流
    已有 auto_score/auto_dims 的 pending 直接按当前阈值重分流（缓存复用，零 LLM 成本）"""
    t0 = time.time()
    idset = set(ids) if ids else None
    with hooks_mod._LOCK:
        d = hooks_mod._load()
    pending = [h for h in d["hooks"]
               if h.get("status") == "pending" and (not idset or h["id"] in idset)]
    if not pending:
        return {"reviewed": 0, "approved": 0, "rejected": 0, "kept_pending": 0,
                "dup_rejected": 0, "llm_used": False, "engine": llm.MODEL,
                "elapsed_s": round(time.time() - t0, 1), "details": [],
                "message": "无待审钩子"}

    approved_texts = [h["text"] for h in d["hooks"] if h.get("status") in ("approved", "auto_pass")]
    details, to_llm, cached, kept_in_batch = [], [], [], []

    # ① 规则层：查重拒收（含批内互撞，保先拒后）
    for h in pending:
        sim, hit = _dedup_check(h["text"], approved_texts + kept_in_batch)
        if sim >= DUP_THRESHOLD:
            reason = f"同质化查重：与「{(hit or '')[:20]}」相似度 {sim:.2f}"
            hooks_mod.review_hook(h["id"], False, reviewer="规则查重", note=reason)
            details.append({"id": h["id"], "name": h["name"], "verdict": "rejected",
                            "rule": "dup", "sim": round(sim, 2), "reason": reason,
                            "score": None})
        elif h.get("auto_score") is not None and isinstance(h.get("auto_dims"), dict):
            cached.append(h)  # 上次已评审，直接复用分数
            kept_in_batch.append(h["text"])
        else:
            to_llm.append(h)
            kept_in_batch.append(h["text"])

    # ② 分流：缓存复用（零成本）→ LLM 批量评审
    dup_n = len(details)
    llm_used = False
    for h in cached:
        r = dict(h["auto_dims"])
        r.setdefault("reason", "复用上次评审")
        verdict = _route(h, r, h["auto_score"])
        details.append({"id": h["id"], "name": h["name"], "verdict": verdict,
                        "score": h["auto_score"], "dims": h["auto_dims"], "cached": True})
    for i in range(0, len(to_llm), max(1, batch_size)):
        batch = to_llm[i:i + max(1, batch_size)]
        reviews = await _llm_review(batch)
        for h in batch:
            r = (reviews or {}).get(h["id"])
            if not r:
                _annotate(h["id"], note="LLM 评审不可用，留人工审核")
                details.append({"id": h["id"], "name": h["name"], "verdict": "manual",
                                "reason": "LLM 不可用", "score": None})
                continue
            llm_used = True
            score = _composite(r)
            verdict = _route(h, r, score)
            details.append({"id": h["id"], "name": h["name"], "verdict": verdict,
                            "score": score, "dims": _dims(r)})

    approved_n = sum(1 for x in details if x["verdict"] == "approved")
    rejected_n = sum(1 for x in details if x["verdict"] == "rejected")
    return {
        "reviewed": len(pending),
        "approved": approved_n,
        "rejected": rejected_n,
        "kept_pending": len(pending) - approved_n - rejected_n,
        "dup_rejected": dup_n,
        "llm_used": llm_used,
        "engine": llm.MODEL,
        "elapsed_s": round(time.time() - t0, 1),
        "details": details,
    }
