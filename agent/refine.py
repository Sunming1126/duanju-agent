# -*- coding: utf-8 -*-
"""精修改写节点：按质检报告修复剧本，修复后复检输出 before→after 对比

改写策略（LLM 优先，失败自动落规则改写，保证永远可运行）：
1. LLM 改写  —— 带质检问题清单重写剧本（保留场次结构/人物/钩子），提示词按输出语言分派
2. 规则改写  —— 确定性安全的修复动作：
   - 模板词清理：标题节拍词剥离 + 短语映射替换（仅中文；日文规则词典为空时自动跳过）
   - 万能旁白删除（仅中文）
   - 台词口语化（书面词映射，仅中文）
   - 补片尾钩子（钩子文案按输出语言本地化）
   - 补场次（不足 3 场时；场次标记按输出语言）
"""
import re

from . import llm, fallback, quality
from . import localization as loc

# ---------- 规则改写词典（具体化表达，均为可拍摄动作） ----------

PHRASE_REWRITES = {
    "气场全开": "步子放慢，下巴抬起来",
    "缓步上前": "慢慢走过去",
    "气氛降至冰点": "没人接话，静得能听见空调声",
    "气氛瞬间凝固": "谁都没说话",
    "空气仿佛凝固": "没人说话，风扇声都听得见",
    "眼中闪过一丝": "眼神动了一下——",
    "惊呼声压不住": "有人倒吸了一口气",
    "窃窃私语": "交头接耳",
    "暗流涌动": "几个人交换了一下眼神",
    "风起云涌": "事情开始起变化",
    "命运的齿轮开始转动": "事情开始起变化",
    "命运的齿轮悄然转动": "事情开始起变化",
    "天命所归": "所有人都盯着他",
    "杀气腾腾": "拳头攥紧了",
    "对面的表情从轻蔑变成惊愕，再到恐慌": "对面先嗤了一声，接着笑容停在脸上，手里的杯子晃了一下",
}

# 标题节拍词剥离：【第1集 · 受辱铺垫】→【第1集】（fallback 实际格式：整行【】包裹）
BEAT_TITLE_RE = re.compile(r"(【\s*第\s*[0-9一二三四五六七八九十百]+\s*[集話章]\s*)[·•\-]?\s*[^】]{2,10}(】)")


def rule_refine(script: str, hero: str, genre: str, qc: dict,
                output_locale: str = "zh-CN", content_type: str = "short_drama", market: str = "china") -> tuple:
    """规则改写：返回 (new_script, changes)。日文/英文稿跳过中文词表类修复（避免误伤自然语）。"""
    is_zh = output_locale == "zh-CN"
    is_novel = content_type == "novel"
    hits = qc.get("hits", {})
    changes = []

    def log(item, count, samples):
        if count:
            changes.append({"item": item, "count": count, "samples": samples[:3]})

    s = script

    # 1. 标题节拍词剥离：【第N集 · 节拍名】→【第N集】（兼容 話/章）
    n_before = len(BEAT_TITLE_RE.findall(s))
    if n_before:
        s = BEAT_TITLE_RE.sub(r"\1\2", s)
        log("标题节拍词剥离", n_before, ["【第N集 · 节拍名】→【第N集】"])

    # 2. 模板短语映射替换（中文稿专属词典）
    if is_zh:
        phrase_hits = []
        for w, rep in PHRASE_REWRITES.items():
            c = s.count(w)
            if c:
                s = s.replace(w, rep)
                phrase_hits.append(f"{w} → {rep}")
        # 质检命中但无映射的模板词：直接摘除（避免术语腔残留）
        for w in hits.get("template", {}):
            if w in s:
                s = s.replace(w, "")
                phrase_hits.append(f"摘除术语「{w}」")
        log("模板词/AI味清理", len(phrase_hits), phrase_hits)

        # 3. 万能旁白删除（仅中文）
        narr = quality.NARRATION_RE.findall(s)
        if narr:
            s = quality.NARRATION_RE.sub("", s)
            s = re.sub(r"\n{3,}", "\n\n", s)
            log("万能旁白删除", len(narr), ["「没人知道，命运……」式旁白整行删除"])
    else:
        # 日文/英文稿：质检命中的模板词仅整词摘除（不做中文短语映射）
        if hits.get("template"):
            removed = 0
            for w in hits["template"]:
                if w in s:
                    s = s.replace(w, "")
                    removed += 1
            log("模板词摘除", removed, list(hits["template"].keys())[:3])

    # 4. 补片尾钩子（钩子文案按输出语言；放在口语化之前，补进去的文本也会过替换）
    if not hits.get("tail_hook"):
        hook = fallback._pick_hook(genre, hero, output_locale=output_locale, market=market)
        s = s.rstrip() + f"\n\n{loc.tail_hook_line(output_locale, hook)}"
        log("补片尾钩子", 1, [hook])

    # 5. 补场次（<3 场时追加一个钩子场；小说模式不适用）
    scene_n = len(quality.SCENE_RE.findall(s))
    if not is_novel and scene_n < 3:
        hook = fallback._pick_hook(genre, hero, output_locale=output_locale, market=market)
        s = s.rstrip() + (
            f"\n\n{loc.scene_marker(output_locale, scene_n + 1)} {fallback._scene_setting(output_locale, hero)}\n\n"
            f"{hook}\n"
        )
        log("补场次", 1, [f"追加 {loc.scene_marker(output_locale, scene_n + 1)}（凑足 3 场 2 分钟体量）"])

    # 6. 前3秒钩子（第一场内无悬念要素时，开场插入钩子快切行）
    if not hits.get("open_hook"):
        hook = fallback._pick_hook(genre, hero, output_locale=output_locale, market=market)
        m = quality.SCENE_RE.search(s)
        if m:
            line_end = s.find("\n", m.start())
            if line_end == -1:
                line_end = len(s)
            opener = "【冒頭3秒】" if output_locale == "ja-JP" else \
                "[OPEN 3s]" if output_locale == "en" else "【开场3秒】"
            s = s[:line_end] + f"\n{opener}{hook}" + s[line_end:]
            log("补前3秒钩子", 1, [f"第一场开头插入快切：{hook[:24]}…"])

    # 7. 台词口语化（书面词映射，仅中文；无条件执行且放在最后，保证新增文本也过替换）
    if is_zh:
        samples = []
        total = 0
        for w, rep in quality.BOOKISH_WORDS.items():
            c = s.count(w)
            if c:
                s = s.replace(w, rep)
                total += c
                samples.append(f"{w} → {rep}")
        log("台词口语化", total, samples)

    return s, changes


def _llm_refine_prompt(output_locale: str) -> str:
    if output_locale == "ja-JP":
        return (
            "あなたは脚本リファイン職人です。品質チェックの問題リストに沿って脚本を修正してください。鉄則："
            "場面構造・人物名・筋立てを保持する；セリフは口語化；動作描写は撮影可能な具体動作で書く；"
            "最終行は「【フック】次回予告：<具体的な謎>」のフック行として必ず残し、謎を具体化する（誰/何が起きた/危機は何か）、"
            "削除や「一句の強い謎」等のプレースホルダー化は禁止；"
            "「その時/同時に」式のつなぎを禁止し動作で直接つなぐ；"
            "簡体字・中文語彙・中文句読点があれば自然な日本語へ置換する。"
            "場面行は「シーンN」で始め、セリフ行は「キャラクター（感情）：」の形式を保持。本文のみ出力。")
    if output_locale == "en":
        return (
            "You are a script refinement specialist. Rewrite the script per the QC issue list. Iron rules: "
            "keep scene structure, character names and plot; make dialogue colloquial; describe shootable concrete actions; "
            "keep the final line as \"[HOOK] Ending: <specific suspense>\" and make the suspense concrete (who/what/crisis); "
            "no stock transitions — cut on action. Keep scene lines starting with \"SCENE N\" and dialogue lines "
            "\"CHARACTER (emotion):\". Output the rewritten script only.")
    return (
        "你是短剧剧本精修师。按质检问题清单改写剧本，铁律：保留原有场次结构、人物名、剧情走向；"
        "台词全部口语化；动作描述必须具体可拍摄（写动作，不写氛围）；"
        "结尾最后一行是「【钩子】片尾：<具体悬念>」钩子行，必须原样保留并把悬念内容写具体（谁/发生了什么/危机何在），不许删行，禁止改写成「一句强悬念」等占位文字；"
        "禁止「就在这时/与此同时/时间仿佛静止」式转场，用动作直接衔接；"
        "禁止书面词（究竟/未曾/顿时/此刻/随即/宛如）。"
        "场次行保持「场N」开头，台词行保持「角色（情绪）：台词」。直接输出改写后剧本正文。")


async def refine_script(script: str, parsed: dict, qc: dict,
                        output_locale: str = "zh-CN", content_type: str = "short_drama") -> tuple:
    """精修改写入口：LLM 优先，失败落规则。返回 (new_script, refine_data)"""
    hero = parsed.get("hero", "主角")
    genre = parsed.get("genre", "逆袭")
    issues = [c for c in qc.get("checks", []) if not c["ok"]]

    refined, changes, engine = None, [], "规则改写"

    # 1) LLM 改写（LLM 可用时）
    issue_desc = "\n".join(f"- {c['item']}：{c['detail']}" for c in issues) or "- 台词进一步口语化，动作更具体"
    # LLM 层发现的隐性 AI 味（词表之外），一并交给改写
    llm_issues = ((qc.get("llm_review") or {}).get("ai_flavor") or {}).get("issues", [])
    if llm_issues:
        issue_desc += "\n隐性 AI 味（语义检测，需消除）：\n" + "\n".join(
            f"- 「{i.get('quote', '')}」：{i.get('why', '')} → {i.get('fix', '')}"
            for i in llm_issues[:6]
        )
    try:
        llm_out = await llm.chat(
            [
                {"role": "system", "content": _llm_refine_prompt(output_locale) + loc.language_instruction(output_locale, parsed.get("market", ""))},
                {"role": "user", "content": f"质检问题清单：\n{issue_desc}\n\n剧本：\n{script}"},
            ],
            temperature=0.6,
            max_tokens=2000,
        )
        if llm_out and len(llm_out) > 100 and quality.SCENE_RE.search(llm_out):
            refined, engine = llm_out, f"{llm.MODEL} 精修"
    except Exception:
        refined = None

    # 2) 规则改写兜底（LLM 失败时兜底；LLM 成功时在 LLM 结果上叠加确定性修复）
    refined, rule_changes = rule_refine(refined or script, hero, genre, qc,
                                        output_locale=output_locale, content_type=content_type, market=parsed.get("market", "china"))
    if rule_changes:
        changes.extend(rule_changes)

    # 3) 复检对比
    qc_after = quality.check_script(refined, locale=output_locale, content_type=content_type)
    data = {
        "engine": engine,
        "changes": changes,
        "text": refined,
        "before_score": qc.get("score", 0),
        "after_score": qc_after["score"],
        "before_summary": qc.get("summary", ""),
        "after_summary": qc_after["summary"],
        "issues_fixed": len([c for c in qc.get("checks", []) if not c["ok"]])
                        - len([c for c in qc_after["checks"] if not c["ok"]]),
    }
    return refined, data
