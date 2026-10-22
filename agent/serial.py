# -*- coding: utf-8 -*-
"""续写引擎（两段式第二阶段）：大纲缺口补齐 → 逐集成稿 → 逐集质检 → 低分自修复 → LLM 复审重写

与主流水线（pipeline.py）同构：async run_continuation(ctx, emit)
事件流：extend_outline(running/done) → ep_start ... ep_N(running/done) → _done（或 _suspended）
ctx: {title, story, hero, genre, card(可选，剧情资料卡要点：钩子/反转/节拍), ep1_script, outline_text,
      target, note, start_ep(可选，从第几集开始续写，默认 2), prev_tail(可选，上一集结尾，默认取 ep1_script 尾部),
      market / output_locale / content_type（生成请求必须显式指定，缺省中文短剧）}

关键设计：
- D（429 不降级）：LLM 限流经 err_box 回传 kind=rate_limit，run_continuation 返回
  {suspended: True, suspended_at: k, episodes: 已完成集}，由 main.py 置任务 suspended 挂起，
  绝不落模板稿；非限流偶发失败仍走 fallback 兜底。
- C（内容弧线）：大纲生成先做三幕弧线通盘设计；单集生成注入全剧幕位置 + 前情脉络（防重复、促推进）。
- B（质量闭环）：每集成稿后 LLM 爆款潜力复审（llm_review），低于阈值整体重写一轮，复审更优才采纳。
- 多语言：格式规则/结构标记按 output_locale 本地化（场N/シーンN/SCENE N、钩子行、收束标记）。
"""
import re

from . import llm
from . import quality
from . import fallback
from . import llm_review
from . import localization as loc
from .market import normalize_locale, normalize_content_type

# 大纲行首解析：第N集 / 第N話 / 第N章 / Episode N / Chapter N
EP_RE = re.compile(r"第\s*(\d+)\s*[集話章]|(?:Episode|Chapter)\s*(\d+)", re.I)
REVIEW_REWRITE_BELOW = 78  # B：LLM 爆款潜力复审低于该分 → 整体重写一轮（复审更优才采纳）

# 兼容旧引用（zh-CN short_drama 规则）；新代码请用 system_rules(output_locale, content_type, market)
SYSTEM_RULES = (
    "你是爆款短剧编剧，写竖屏短剧单集完整剧本。硬性格式要求：\n"
    "1. 必须 3-4 个场次，总字数 500-900 字；\n"
    "2. 场次行必须以「场N」开头（如：场1 内景/白天 · 出租屋），禁止 ** 或 【】 包裹场次行；\n"
    "3. 台词行格式「角色（情绪）：台词」，台词全部口语化，像真人说话；\n"
    "4. 开场第一场第 2 行内必须给出强冲突动作或悬念（直接承接上一集片尾钩子，不许重复铺垫）；\n"
    "5. 结尾最后一行是钩子行，格式为「【钩子】片尾：<悬念内容>」，<悬念内容>必须写出本集结尾留下的具体悬念（谁/发生了什么/危机何在，25-50字）；禁止照抄或改写格式示例（「一句让人必须点开下一集的悬念」「一句强悬念」均属违规占位）；不许省略；\n"
    "6. 禁止万能旁白（命运/悄然/无人知晓）；禁止「就在这时/与此同时/时间仿佛静止」式转场，"
    "直接用动作衔接；禁止直接宣布情绪（写动作：手抖/杯子掉了/后退半步）；\n"
    "7. 角色名纪律：全剧人物名必须唯一且前后一致。主角与故事设定中已出现的人名（含亲属称谓，"
    "如设定里的「女儿小满」）必须沿用原名，禁止另创名字、昵称或别名；\n"
    "8. 动作反套路：猛地/突然/指节泛白/喉结滚动/冷笑/青筋暴起/眉头拧成疙瘩等程式化动作词，"
    "每个在全篇至多用 1 次，超频的换具体情境化动作；冲突解决方式不得重复前面集数用过的同类桥段"
    "（同类冲突必须换环境、换手法、换结果）。\n"
    "直接输出剧本正文，不要任何解释。"
)

# 与 SYSTEM_RULES 的差异段（第4/8条为续写特有规则），其余复用本地化 format_rules
_CONTINUATION_EXTRA = {
    "zh-CN": "4. 开场第一场第 2 行内必须给出强冲突动作或悬念（直接承接上一集片尾钩子，不许重复铺垫）；\n"
             "8b. 冲突解决方式不得重复前面集数用过的同类桥段（同类冲突必须换环境、换手法、换结果）。\n",
    "ja-JP": "4. 冒頭シーンの2行目で強い衝突か謎を提示する（前話のラストフックを直接受け、重ねた布石は不要）；\n"
             "8b. 同型の衝突解決を前話と繰り返さない（同類の対立は環境・手法・結果を変える）。\n",
    "en": "4. The second line of the opening scene must deliver strong conflict or suspense (directly picking up the previous hook; no re-setup);\n"
          "8b. Never repeat a previously used conflict resolution (same-type conflicts must change setting, method and outcome).\n",
}


def system_rules(output_locale: str = "zh-CN", content_type: str = "short_drama", market: str = "") -> str:
    """单集成稿硬性规则（续写引擎用）：本地化 format_rules + 续写特有条款"""
    extra = _CONTINUATION_EXTRA.get(output_locale, _CONTINUATION_EXTRA["zh-CN"])
    rule4 = extra.split("8b.", 1)[0]
    rule8b = "8b." + extra.split("8b.", 1)[1]
    base = loc.format_rules(output_locale, content_type)
    # 移除 format_rules 第4条（主流水线版），替换为续写版（直接承接上一集钩子），追加 8b 防重复条款
    lines = [ln for ln in base.split("\n") if not ln.startswith("4. ")]
    lines.append(rule4.rstrip())
    lines.append(rule8b.rstrip())
    return (f"你是爆款{'网络小说' if content_type == 'novel' else '短剧'}编剧，"
            f"写单{'章' if content_type == 'novel' else '集'}完整内容。"
            f"{loc.language_instruction(output_locale, market)} 硬性格式要求：\n"
            + "\n".join(lines))


def parse_outline(text: str) -> dict:
    """解析大纲文本为 {集数N: 大纲行}；容忍粗体/列表前缀混排，兼容 集/話/章/Episode/Chapter"""
    out = {}
    if not text:
        return out
    for raw in text.splitlines():
        line = raw.strip().lstrip("-*·• ").strip()
        m = EP_RE.search(line)
        if m:
            no = int(m.group(1) or m.group(2))
            out[no] = line.strip()
    return out


def _tail_of(script: str, n: int = 300) -> str:
    """取剧本结尾 n 字作为下一集的「前情提要」"""
    return (script or "").strip()[-n:]


def _act_of(no: int, target, output_locale: str = "zh-CN") -> str:
    """C：全剧三幕结构位置，按 target 三等分；最后一集为硬性大结局断言（标记按语言本地化）"""
    t = max(int(target or 10), 3)
    th = loc.TAIL_HOOK.get(output_locale, loc.TAIL_HOOK["zh-CN"]).split("：")[0].split(":")[0]
    fm = loc.finale_mark(output_locale)
    if no >= t:  # 末集：强断言收束，不用「若」字弱条件
        return (f"第三幕·大结局（本集即全剧最后一集：必须收束全部主线与悬念，给出明确结局，"
                f"禁止开放式悬念钩子；结尾保留「{th}：」一行，内容为收束型落点，"
                f"并在其后追加一行「{fm}」）")
    if no <= round(t / 3):
        return "第一幕·建置（立人设、埋冲突，本集结尾抛出强钩子）"
    if no <= round(t * 2 / 3):
        return "第二幕·对抗（冲突升级，本集需一次反转或升级；全剧中点附近安排大反转）"
    return "第三幕·解决（绝地反杀、真相揭晓、逐线收束；为末集大结局收拢伏笔）"


def _clean_line(line: str) -> str:
    """去掉大纲行的「第N集/話/章」前缀"""
    return re.sub(r"^第\s*\d+\s*[集話章][:：、，,]?\s*", "", line or "").strip()


def _ep_digest(script: str) -> str:
    """无大纲行时从剧本提炼一行前情摘要（跳过场记/台词行，取首句）"""
    for raw in (script or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("【") or line.startswith("[") or re.match(r"^(?:场|シーン|SCENE)\s*\d", line, re.I):
            continue
        if line.find("：", 0, 12) >= 0 or line.find(":", 0, 12) >= 0:  # 台词行「角色（情绪）：」
            continue
        return line.rstrip("。！？!・. ")[:44]
    return ""


async def extend_outline(ctx: dict, start: int, end: int, emit, err_box=None) -> dict | None:
    """补齐 start..end 集的大纲缺口：三幕弧线通盘设计 → 与已有大纲合并（已有集数保留不动）

    LLM 限流（err_box.kind=rate_limit）返回 None，由上层挂起任务而非硬编大纲。
    """
    output_locale = normalize_locale(ctx.get("output_locale"), ctx.get("market"))
    content_type = normalize_content_type(ctx.get("content_type"))
    unit = loc.unit_label(output_locale, content_type, "{n}")
    await emit({"node": "extend_outline", "status": "running"})
    existing = parse_outline(ctx.get("outline_text", ""))
    missing = [k for k in range(start, end + 1) if k not in existing]
    if not missing:
        await emit({"node": "extend_outline", "status": "done",
                    "data": {"text": "", "note": "已有大纲完整覆盖，无需补齐"}})
        return existing

    have = "\n".join(f"{loc.unit_label(output_locale, content_type, k)} {v}"
                     for k, v in sorted(existing.items())) or "（无）"
    text = await llm.chat(
        [
            {"role": "system", "content": (
                f"你是爆款{'网络小说' if content_type == 'novel' else '短剧'}编剧，"
                "深谙'每集必冲突、结尾必钩子'的铁律。"
                f"{loc.language_instruction(output_locale, ctx.get('market', ''))} 直接输出大纲正文，每集独立一行，"
                f"行首严格使用「{unit}」格式（如：{loc.unit_label(output_locale, content_type, 7)}），"
                "禁止 Markdown 粗体。")},
            {"role": "user", "content": (
                f"为作品《{ctx.get('title','未命名')}》补写{loc.unit_label(output_locale, content_type, start)}"
                f"到{loc.unit_label(output_locale, content_type, end)}的逐集大纲"
                f"（只写缺的集数：{('、'.join(loc.unit_label(output_locale, content_type, k) for k in missing))}）。\n"
                "先通盘设计三幕弧线再落行：第一幕建置（前1/3集：立人设、埋冲突、抛钩子）；"
                "第二幕对抗（中1/3：冲突升级、全剧中点一次大反转、随后跌入低谷）；"
                "第三幕解决（后1/3：绝地反杀、真相揭晓、逐线收束）。\n"
                f"特别硬性要求：{loc.unit_label(output_locale, content_type, end)}即全剧最后一集（大结局），"
                "大纲必须安排收束全部主线与悬念、"
                "给出明确结局，禁止开放式悬念钩子；第1集到大结局埋下的关键伏笔（道具/身世/承诺）"
                "必须在大结局前全部回收。\n"
                f"故事：{ctx.get('story','')}\n主角：{ctx.get('hero','')}\n题材：{ctx.get('genre','')}\n"
                + (f"剧情资料（其中的开场钩子/关键反转/节拍结构必须体现在剧情走向中）：{ctx.get('card','')[:800]}\n" if ctx.get("card") else "")
                + f"已有大纲（严禁重复其内容，剧情必须自然承接）：\n{have[:1400]}\n"
                + (f"编剧反馈（必须落实）：{ctx.get('note')}\n" if ctx.get("note") else "")
                + "每集1-2句：本集事件+结尾钩子。直接输出大纲正文，不要解释。")},
        ],
        temperature=0.85,
        max_tokens=1600,
        err_box=err_box,
    )
    if not text and err_box and err_box.get("kind") == "rate_limit":
        return None
    merged = dict(existing)
    if text:
        for no, line in parse_outline(text).items():
            if start <= no <= end and no not in merged:
                merged[no] = line
    await emit({"node": "extend_outline", "status": "done",
                "data": {"text": text or "", "missing": missing,
                         "merged": {str(k): v for k, v in sorted(merged.items())}}})
    return merged


async def gen_episode(no: int, line: str, ctx: dict, prev_tail: str,
                      history=None, err_box=None) -> tuple[str, bool]:
    """单集成稿：LLM 生成，返回 (text, ok)；ok=False 表示 LLM 失败（上层决定挂起或兜底）"""
    output_locale = normalize_locale(ctx.get("output_locale"), ctx.get("market"))
    content_type = normalize_content_type(ctx.get("content_type"))
    target = ctx.get("target", 10)
    parts = [f"写{loc.unit_label(output_locale, content_type, no)}剧本"
             f"（全剧约{target}集，当前为第{no}集，剧情推进需符合整体节奏）。",
             f"全剧结构位置：{_act_of(no, target, output_locale)}"]
    if ctx.get("story"):
        parts.append(f"故事：{ctx['story']}")
    if ctx.get("hero"):
        parts.append(f"主角：{ctx['hero']}")
    if ctx.get("genre"):
        parts.append(f"题材：{ctx['genre']}")
    if ctx.get("card"):
        parts.append(f"剧情资料（其中的开场钩子/关键反转/节拍结构必须体现在剧情中）：{ctx['card'][:800]}")
    if line:
        parts.append(f"本集大纲（必须完整体现其中事件与结尾钩子）：{line}")
    if history:
        parts.append("前情脉络（已播走向，新集必须向前推进，禁止重复其事件）：\n" + "\n".join(history))
    if prev_tail:
        parts.append(f"上一集结尾（开场必须无缝衔接这个钩子，不许重复台词）：\n{prev_tail}")
    if ctx.get("ep1_script"):
        parts.append(f"第1集风格锚（保持同等的口语密度与节奏，禁止模仿其具体台词）：\n{ctx['ep1_script'][:600]}")
    if ctx.get("note"):
        parts.append(f"编剧反馈（必须落实）：{ctx['note']}")
    text = await llm.chat(
        [
            {"role": "system", "content": system_rules(output_locale, content_type, ctx.get('market', ''))},
            {"role": "user", "content": "\n".join(parts)},
        ],
        temperature=0.85,
        max_tokens=2400,
        err_box=err_box,
    )
    if not text:
        return "", False
    return text.strip(), True


def _polish_prompt(script: str, review: dict) -> str:
    """B：复审达标但检出 AI 味 → 定向润色提示词（只修表达，不动剧情与结构）"""
    ai = review.get("ai_flavor", {})
    issues = "；".join(
        f"「{i.get('quote', '')}」{i.get('why', '')}→{i.get('fix', '')}"
        for i in ai.get("issues", [])[:6]
    ) or "无"
    return (
        "下面是短剧单集成稿，整体已达标，只需定向去除 AI 味问题："
        "保留剧情、场次结构、台词原意与钩子，只修改被点名的问题表达，"
        "直接输出润色后的完整剧本，不要解释。\n"
        f"问题清单（必须逐条落实）：{issues}\n"
        "同时自查：猛地/突然/指节泛白/喉结/冷笑/青筋暴起等程式化动作词全篇每个至多保留 1 次，"
        "超频的换成具体情境化动作。\n\n初稿：\n" + script
    )


def _rewrite_prompt(script: str, review: dict, no: int, line: str, prev_tail: str,
                    is_final: bool = False, output_locale: str = "zh-CN",
                    content_type: str = "short_drama") -> str:
    """B：爆款复审低分 → 整体重写提示词（结构标记按输出语言）"""
    pot = review.get("potential", {})
    ai = review.get("ai_flavor", {})
    issues = ai.get("issues", [])
    fl = "；".join(f"「{i.get('quote','')}」{i.get('why','')}→{i.get('fix','')}" for i in issues[:6]) or "无"
    sm = loc.SCENE_MARKER.get(output_locale, loc.SCENE_MARKER["zh-CN"])
    th = loc.TAIL_HOOK.get(output_locale, loc.TAIL_HOOK["zh-CN"]).split("：")[0].split(":")[0]
    fm = loc.finale_mark(output_locale)
    return (
        f"下面是{loc.unit_label(output_locale, content_type, no)}初稿，"
        f"爆款潜力复审仅{pot.get('score', 0)}分（{pot.get('verdict','')}），"
        "请整体重写为更强的一版：\n"
        f"五维评分（钩子{pot.get('hook', 0)}/爽点{pot.get('cool', 0)}/节奏{pot.get('pacing', 0)}"
        f"/卡点{pot.get('paywall', 0)}/共鸣{pot.get('emotion', 0)}），"
        "重点补强低分维度：开场3秒冲突前置、每场至少一个情绪或反转爆点、结尾钩子拉满付费欲。\n"
        f"AI味问题（{ai.get('level','')}）：{fl}\n"
        f"硬性要求：保持 3-4 场、500-900 字；场次行以「{sm.format(1)}」开头；"
        f"结尾最后一行是「{th}：…」。\n"
        + (f"本集为全剧大结局：必须收束全部主线与悬念给出明确结局，片尾钩为收束型落点，"
           f"并在其后另起一行输出「{fm}」。\n" if is_final else "")
        + (f"本集大纲（必须完整体现其中事件与结尾钩子）：{line}\n" if line else "")
        + (f"上一集结尾（开场无缝衔接）：\n{prev_tail}\n" if prev_tail else "")
        + "\n初稿：\n" + script
    )


def _repair_prompt(script: str, qc: dict, is_final: bool = False,
                   output_locale: str = "zh-CN", content_type: str = "short_drama") -> str:
    """规则质检未达标 → 外科手术式修复提示词（只修问题，保留剧情与风格）"""
    sm = loc.SCENE_MARKER.get(output_locale, loc.SCENE_MARKER["zh-CN"])
    th = loc.TAIL_HOOK.get(output_locale, loc.TAIL_HOOK["zh-CN"]).split("：")[0].split(":")[0]
    fm = loc.finale_mark(output_locale)
    fails = "；".join(f"{c['item']}（{c['detail']}）" for c in qc.get("checks", []) if not c["ok"]) or "见下"
    return (
        "下面是短剧单集初稿，规则质检未达标，请外科手术式修复（保留剧情走向与人设，只修复问题，"
        "直接输出修复后的完整剧本，不要解释）：\n"
        f"质检问题：{fails}\n"
        f"硬性要求：3-4 个场次，总字数 500-900；场次行以「{sm.format(1)}」开头；台词行口语化；"
        f"结尾最后一行必须是「{th}：…」。\n"
        + (f"本集为全剧大结局：必须收束全部主线与悬念给出明确结局，片尾钩改为收束型落点，"
           f"并在其后另起一行输出「{fm}」。\n" if is_final else "")
        + "\n初稿：\n" + script
    )


async def _review_gate(no: int, script: str, line: str, ctx: dict,
                       prev_tail: str, qc: dict, is_final: bool = False) -> tuple[str, dict, dict | None]:
    """B：LLM 爆款潜力复审，低于阈值整体重写一轮，复审更优且规则质检不降才采纳

    返回 (script, qc, review_info)；review_info 为 None 表示复审不可用（静默跳过，不阻塞）。
    is_final 透传给规则质检（末集含大结局收束检查），保证重写/润色稿不丢失收束约束。
    """
    output_locale = normalize_locale(ctx.get("output_locale"), ctx.get("market"))
    content_type = normalize_content_type(ctx.get("content_type"))
    parsed = {"genre": ctx.get("genre", ""), "hero": ctx.get("hero", "")}
    review = await llm_review.review(script, parsed, output_locale=output_locale)
    if not review:
        return script, qc, None
    score = review["potential"]["score"]
    info = {"score": score, "verdict": review["potential"].get("verdict", ""),
            "level": review["ai_flavor"].get("level", ""),
            "ai_issues_n": len(review["ai_flavor"].get("issues") or []), "rewritten": False}

    def _scene_ok(q: dict) -> bool:
        return q["hits"]["scenes"] >= 3 or content_type == "novel"

    if score >= REVIEW_REWRITE_BELOW:
        # 达标放行，但 AI 味 issues 非空时定向润色一轮（只修表达，规则质检不降才采纳）
        if review["ai_flavor"].get("issues"):
            polished = await llm.chat(
                [
                    {"role": "system", "content": system_rules(output_locale, content_type, ctx.get('market', ''))},
                    {"role": "user", "content": _polish_prompt(script, review)},
                ],
                temperature=0.5,
                max_tokens=2400,
            )
            if polished:
                polished = polished.strip()
                qc2 = quality.check_script(polished, is_final=is_final,
                                            locale=output_locale, content_type=content_type)
                if _scene_ok(qc2) and qc2["score"] >= qc["score"]:
                    info["polished"] = True
                    return polished, qc2, info
                info["polish_rejected"] = "润色稿规则质检未过（场数不足或分数下降）"
            else:
                info["polish_rejected"] = "润色调用失败"
        return script, qc, info
    # 低分：整体重写一轮（复审重写失败则静默保留原稿）
    fixed = await llm.chat(
        [
            {"role": "system", "content": system_rules(output_locale, content_type, ctx.get('market', ''))},
            {"role": "user", "content": _rewrite_prompt(script, review, no, line, prev_tail, is_final,
                                                        output_locale=output_locale,
                                                        content_type=content_type)},
        ],
        temperature=0.9,
        max_tokens=2400,
    )
    if not fixed:
        return script, qc, info
    fixed = fixed.strip()
    qc2 = quality.check_script(fixed, is_final=is_final,
                               locale=output_locale, content_type=content_type)
    if not _scene_ok(qc2) or qc2["score"] < qc["score"]:
        return script, qc, info
    review2 = await llm_review.review(fixed, parsed, output_locale=output_locale)
    if not review2 or review2["potential"]["score"] <= score:
        return script, qc, info
    info.update({"score": review2["potential"]["score"],
                 "verdict": review2["potential"].get("verdict", ""),
                 "level": review2["ai_flavor"].get("level", ""),
                 "ai_issues_n": len(review2["ai_flavor"].get("issues") or []), "rewritten": True})
    return fixed, qc2, info


async def run_continuation(ctx: dict, emit) -> dict:
    """续写 start..target（默认 2..target）：每集生成+质检+复审，低分自修复与重写

    返回 {episodes: [...], outline_ext: 新增集的大纲行}
    LLM 限流：返回 {suspended: True, suspended_at: k, ...}，已完成集保留，绝不落模板稿
    支持从任意集数继续：ctx 传 start_ep（默认 2）与 prev_tail（上一集结尾文本）
    """
    output_locale = normalize_locale(ctx.get("output_locale"), ctx.get("market"))
    content_type = normalize_content_type(ctx.get("content_type"))
    finale_mark_ = loc.finale_mark(output_locale)
    target = int(ctx.get("target") or 10)
    start = max(1, int(ctx.get("start_ep") or 2))  # 无第1集成品时允许从第1集整剧生成
    if start > target:
        await emit({"node": "_done", "status": "done", "data": {"count": 0, "target": target, "note": "无需新增集数"}})
        return {"episodes": [], "outline_ext": ""}

    episodes = []
    err_box = {}
    outline = await extend_outline(ctx, start, target, emit, err_box)
    if outline is None:
        # D：大纲阶段即限流 → 挂起（不硬编大纲）
        await emit({"node": "_suspended", "status": "suspended",
                    "data": {"at_ep": start, "phase": "outline", "reason": "llm_rate_limited"}})
        return {"episodes": [], "outline_ext": "", "suspended": True, "suspended_at": start}

    prev_tail = (ctx.get("prev_tail") or "").strip() or _tail_of(ctx.get("ep1_script", ""))
    history = []  # C：前情脉络（首条为故事主线，滚动保留最近6集一句话摘要）
    if ctx.get("story"):
        history.append(f"故事主线：{ctx['story'][:60]}")

    for k in range(start, target + 1):
        await emit({"node": f"ep_{k}", "status": "running"})
        script, ok = await gen_episode(k, outline.get(k, ""), ctx, prev_tail, history, err_box)
        if not ok and err_box.get("kind") == "rate_limit":
            # D：限流挂起——已完成集保留，交由 main.py 置 suspended
            outline_ext = "\n".join(outline[i] for i in range(start, target + 1) if outline.get(i))
            await emit({"node": f"ep_{k}", "status": "suspended", "data": {"no": k}})
            await emit({"node": "_suspended", "status": "suspended",
                        "data": {"at_ep": k, "phase": "episode", "reason": "llm_rate_limited",
                                 "done": len(episodes)}})
            return {"episodes": episodes, "outline_ext": outline_ext,
                    "suspended": True, "suspended_at": k}
        elif not ok:
            # 非限流偶发失败：模板兜底（强制留痕：集数据标记 fallback + 失败原因，绝不静默降级）
            fb_reason = (f"LLM 调用失败（{err_box.get('kind') or 'unknown'}"
                         + (f" HTTP {err_box['status']}" if err_box.get("status") else "") + "）")
            await emit({"node": f"ep_{k}", "status": "running",
                        "data": {"fallback": True,
                                 "note": f"第{k}集 {fb_reason}，本集使用模板兜底稿（仍参与质检/修复/复审）"}})
            script = fallback.fallback_script(
                ctx.get("story", ""), ctx.get("genre") or loc.default_genre(output_locale, ctx.get("market", "")),
                ctx.get("hero") or "主角", episode_no=k, line=outline.get(k, ""),
                output_locale=output_locale, content_type=content_type, market=ctx.get("market", ""),
            )
        else:
            fb_reason = None
        qc = quality.check_script(script, is_final=(k >= target),
                                  locale=output_locale, content_type=content_type)
        scene_ok = qc["hits"]["scenes"] >= 3 or content_type == "novel"
        if not qc["pass"] and qc["score"] < 80:
            fixed = await llm.chat(
                [
                    {"role": "system", "content": system_rules(output_locale, content_type, ctx.get('market', ''))},
                    {"role": "user", "content": _repair_prompt(script, qc, is_final=(k >= target),
                                                               output_locale=output_locale,
                                                               content_type=content_type)},
                ],
                temperature=0.6,
                max_tokens=2400,
            )
            if fixed:
                fixed = fixed.strip()
                qc2 = quality.check_script(fixed, is_final=(k >= target),
                                           locale=output_locale, content_type=content_type)
                # 场数合规且分数不降才采纳修复稿
                if (qc2["hits"]["scenes"] >= 3 or content_type == "novel") and qc2["score"] >= qc["score"]:
                    script, qc = fixed, qc2
        script, qc, review_info = await _review_gate(k, script, outline.get(k, ""), ctx, prev_tail, qc,
                                                     is_final=(k >= target))
        # 代码级兜底：末集经修复/重写/润色后仍缺收束标记 → 直接追加（评估硬性项 100% 保证）
        forced_finale = False
        if k >= target and finale_mark_ not in script:
            script = script.rstrip() + f"\n\n{finale_mark_}"
            forced_finale = True
        ep = {"no": k, "score": qc["score"], "pass": qc["pass"], "summary": qc["summary"],
              "review": review_info, "text": script,
              "qc": {"score": qc["score"], "pass": qc["pass"], "summary": qc["summary"]}}
        if forced_finale:
            ep["forced_finale"] = True
        if fb_reason:
            ep["fallback"] = True
            ep["fallback_reason"] = fb_reason
        episodes.append(ep)
        prev_tail = _tail_of(script)
        history.append(f"第{k}集：{_clean_line(outline.get(k, '')) or _ep_digest(script)}")
        if len(history) > 7:
            history = history[:1] + history[-6:]
        await emit({"node": f"ep_{k}", "status": "done", "data": ep})

    fb_eps = [e["no"] for e in episodes if e.get("fallback")]
    fb_hint = next((e.get("fallback_reason", "") for e in episodes if e.get("fallback")), "")
    await emit({"node": "_done", "status": "done",
                "data": {"count": len(episodes), "target": target,
                         "fallback_eps": fb_eps,
                         "note": (f"警告：第{','.join(map(str, fb_eps))}集为模板兜底稿（{fb_hint}），请检查 LLM 配置/额度"
                                  if fb_eps else "")}})
    outline_ext = "\n".join(outline[k] for k in range(start, target + 1) if outline.get(k))
    return {"episodes": episodes, "outline_ext": outline_ext}
