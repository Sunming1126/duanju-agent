# -*- coding: utf-8 -*-
"""模块4：小说内容 → 短剧元素转化引擎

两种模式：
  auto  — 规则定位（对话密度/转折词/高潮段落）→ LLM 转化为短剧元素（五段式+钩子+爆点）
  manual — 返回规则分析结果（段落元素清单），由前端人工标注后提交落库
"""
import json
import re

from . import llm, localization as loc
from . import hooks as hooks_mod

TURNING_WORDS = re.compile(r"(突然|瞬间|突然に|まさか|しかし|その時|ところが|unexpectedly|however|suddenly|谁知|竟然|居然|没想到|下一刻|一秒后|转瞬|霎时|蓦地|陡然)")
DIALOGUE_MARK = re.compile(r"[""「」''\"：:]|说|道|喊|问|答|冷笑|低声")


def rule_scan(text):
    """规则分析：段落切分 → 对话密度/转折点/高潮候选评分"""
    paras = [p.strip() for p in re.split(r"\n+", text or "") if p.strip()]
    if not paras:
        sents = re.split(r"[。！？!?]+", text or "")
        paras = [s.strip() for s in sents if s.strip()]

    result = []
    for i, p in enumerate(paras[:80]):
        chars = len(p)
        dialogue = sum(1 for _ in DIALOGUE_MARK.finditer(p)) / max(chars / 10, 1)
        turning = len(TURNING_WORDS.findall(p))
        excl = p.count("！") + p.count("!")
        score = dialogue * 0.4 + turning * 2 + excl * 1.5 + (chars < 30 and len(p) > 8 and 1 or 0)
        result.append({"idx": i, "chars": chars, "dialogue_ratio": round(min(dialogue, 1), 2),
                       "turning_points": turning, "exclamations": excl,
                       "climax_candidate": score >= 3, "score": round(score, 2),
                       "preview": p[:40]})
    climax = max(result, key=lambda x: x["score"]) if result else None
    return {"paragraphs": result, "total_paragraphs": len(paras),
            "climax": {"idx": climax["idx"], "preview": climax["preview"]} if climax else None,
            "dialogue_heavy": sum(1 for r in result if r["dialogue_ratio"] > 0.5)}


async def convert(text, title="", mode="auto", market="china", output_locale="zh-CN"):
    """小说 → 短剧元素转化（auto 全自动 / manual 返回分析供标注）"""
    analysis = rule_scan(text)
    if mode == "manual":
        return {"mode": "manual", "title": title, "analysis": analysis,
                "hint": "请在标注面板为段落打标：爆点/钩子/反转/可删减，提交后入库"}

    climax_idx = analysis.get("climax", {}).get("idx") if analysis.get("climax") else None
    excerpt = "\n".join(
        p["preview"] + "…" for p in analysis["paragraphs"]
        if climax_idx is None or abs(p["idx"] - climax_idx) <= 6)[:2400]

    data = await llm.chat_json(
        [
            {"role": "system", "content": "你是短剧改编师，擅长把小说改编成竖屏短剧。只输出 JSON。" + loc.language_instruction(output_locale, market)},
            {"role": "user", "content":
                f"把以下小说片段转化为短剧元素，输出 JSON：\n"
                '{{"logline":"一句话故事(30字内)",'
                '"structure":[{"beat":"开局炸点","ratio":0.05,"goal":"..."},{"beat":"身份/危机铺垫","ratio":0.2,"goal":"..."},'
                '{"beat":"冲突递进","ratio":0.4,"goal":"..."},{"beat":"大反转","ratio":0.2,"goal":"..."},{"beat":"关系与冲突收束","ratio":0.15,"goal":"..."}],'
                '"hooks":[{"position":"open|mid|tail","mechanism":"悬念|危机|反差|期待|金句","intensity":1-5,"text":"钩子台词/画面"}],'
                '"burst_points":["爆点1","爆点2"],'
                '"cut_suggestions":["建议删除的慢节奏内容说明"],"episodes_hint":"预计集数与每集时长"}\n'
                f"小说名：{title}\n分析：高潮段#{climax_idx}，对话密集段{analysis.get('dialogue_heavy',0)}个\n小说内容：\n{excerpt}"},
        ],
        temperature=0.6, max_tokens=1200,
    )
    if not data:
        data = {"logline": title or "小说改编短剧",
                "structure": [{"beat": b, "ratio": r, "goal": "规则模式：按标准五段式"}
                              for b, r in [("开局炸点", .05), ("身份/危机铺垫", .2), ("冲突递进", .4),
                                           ("大反转", .2), ("关系与冲突收束收官", .15)]],
                "hooks": [{"position": "open", "mechanism": "悬念", "intensity": 3,
                           "text": (analysis.get("climax", {}) or {}).get("preview", "悬念开场")}],
                "burst_points": [p["preview"] for p in analysis["paragraphs"] if p["climax_candidate"]][:3],
                "cut_suggestions": ["规则模式：建议压缩对话密集度低于0.3的段落"],
                "episodes_hint": "建议30-60集×90秒", "_engine": "模板兜底"}

    if data.get("_engine") and output_locale != "zh-CN":
        if output_locale == "ja-JP":
            beats = ["導入", "関係と危機", "葛藤の深化", "転機", "選択と決着"]
            data.update(logline=title or "小説の映像化", episodes_hint="話数と尺は原作に合わせて検討",
                        cut_suggestions=["会話と行動が進まない段落を圧縮する"])
            goal = "ルールによる構成案。原作に合わせて調整"
        else:
            beats = ["Opening", "Relationships and stakes", "Escalation", "Turning point", "Choice and resolution"]
            data.update(logline=title or "Novel adaptation", episodes_hint="Choose episode count and length to fit the source",
                        cut_suggestions=["Condense passages that do not advance dialogue or action"])
            goal = "Rule-based outline; adapt to the source"
        data["structure"] = [{"beat": b, "ratio": r, "goal": goal} for b, r in zip(beats, [.05, .2, .4, .2, .15])]

    # 转化出的钩子自动进审核队列（可选入库）
    saved = 0
    if title:
        for h in (data.get("hooks") or [])[:3]:
            try:
                hooks_mod.create_hook(name=f"【改编】{title}:{h.get('position','open')}",
                                      text=h.get("text", ""), category="期待钩",
                                      position=h.get("position", "open"),
                                      mechanism=h.get("mechanism", "悬念"),
                                      intensity=h.get("intensity", 3),
                                      tags=["小说转化"], status="pending", market=market)
                saved += 1
            except Exception:
                pass
    return {"mode": "auto", "title": title, "analysis": analysis,
            "converted": data, "hooks_saved": saved}
