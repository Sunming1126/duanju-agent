# -*- coding: utf-8 -*-
"""内容质检节点：AI味/模板词扫描 + 竖屏短剧制作标准检查（按语言/内容类型本地化）

10 项检查（对照短剧制作要求）：
1. 模板词/AI味   —— 创作术语腔与通用 AI 腔（中文词典 / 日文词典按 locale 分派）
2. 空话动作      —— 无法拍摄的描述
3. 万能旁白      —— 整行匹配删除（中文；日文交由 LLM 复审语义检测）
4. 台词书面腔    —— 书面词（中文词典；日文跳过规则层，由 LLM 复审覆盖）
5. 动作套话频次  —— 程式化动作词，每词至多1次，超频扣分
6. 场次数量 ≥3   —— 单集 2 分钟体量（novel 类型放宽：不检查场次）
7. 片尾强钩      —— 结尾必须有钩子标记（场N/シーンN/SCENE N 同源本地化标记）
8. 前3秒钩子     —— 第一场内即有冲突/悬念要素（钩子要素词按 locale 分派）
9. 剧本体量 ≥300 字
10. 大结局收束   —— 仅 is_final=True（末集）生效：缺收束标记重扣并阻断 pass
11. 语言一致性   —— 仅日文稿：检测简体字残留/中文词/中文标点（日本市场硬性项）

输出 report：{score, pass, summary, checks:[{item,ok,detail}], hits:{...}}
hits 供 refine 节点定位改写。
"""
import re

from . import localization as loc

# ---------- 中文词典（本次 10 部人工自检沉淀） ----------

# 模板词 / AI 味：fallback 节拍术语 + 通用 AI 腔
TEMPLATE_WORDS = [
    # fallback 节拍术语（出现在正文/标题即算模板痕迹）
    "受辱铺垫", "初遇误会", "含冤而死", "身份悬念", "穿越错位",
    "天才萌宝登场", "重生睁眼", "前世惨死", "强势反杀", "一网打尽",
    "误会加深", "层层迷雾", "惊天反转", "小试牛刀", "树敌招灾",
    "被迫相处", "情敌搅局", "甜蜜和解", "新人任务", "首次兑换",
    "解锁隐藏", "改变第一步", "布局收网", "站稳脚跟", "环境冲突",
    # 通用 AI 腔
    "命运的齿轮", "悄然转向", "悄然改变", "暗中涌动", "风起云涌",
    "气场全开", "气运加身", "天命所归", "命运的安排", "命运捉弄",
]

# 空话动作：不可拍摄的抽象描述
EMPTY_ACTIONS = [
    "气氛紧张", "气氛尴尬", "气氛瞬间", "空气仿佛凝固", "空气凝结",
    "气氛降至冰点", "杀气腾腾", "充满杀意", "眼中闪过一丝", "眼神复杂",
    "心中一凛", "暗流涌动", "充满了愤怒", "充满了悲伤",
]

# 万能旁白：整行匹配删除
NARRATION_RE = re.compile(r"^>?\s*旁白[：:][^\n]*(命运|悄然|此刻|无人知晓|谁也不知|没有人知道)", re.M)

# 动作套话：跨稿高频复用的程式化动作/神态词（每词至多1次，超频扣分）
# 不含「突然」——它同时是钩子要素词（HOOK_WORDS），仅作频次提示不扣分
ACTION_CLICHE_WORDS = [
    "猛地", "指节泛白", "指节发白", "指节捏", "指节咔", "喉结",
    "冷笑", "青筋暴起", "青筋绷起", "眉头拧成疙瘩", "眼底闪过",
    "眸中闪过", "眼神一凛", "像只受惊的猫", "浑身一僵",
]

# 台词书面腔：词 → 口语替换（质检报告计数，refine 执行替换）
BOOKISH_WORDS = {
    "究竟": "到底", "未曾": "没", "何须": "何必", "岂能": "哪能",
    "顿时": "一下", "此刻": "这会儿", "随即": "跟着", "宛如": "像",
    "已然": "已经", "须知": "要知道", "皆是": "都是", "乃是": "是",
}

# 钩子要素词（前3秒/片尾判定）
HOOK_WORDS = [
    "却", "竟", "突然", "下一秒", "神秘", "浮现", "响起", "身影", "瞳孔",
    "僵住", "炸", "倒吸", "收网", "倒计时", "才刚刚", "传来", "多了一",
    "回头", "一模一样", "敲门", "来电", "停住", "没了", "不是", "原来",
]

# ---------- 本地化结构标记（场N / シーンN / SCENE N 同源） ----------

# 场次行：兼容 markdown 装饰混排；【 后必须紧跟标记词，避免误匹配"【开场3秒】"
SCENE_RE = re.compile(
    r"^\s*(?:>\s*)?(?:【(?=\s*(?:场|シーン|SCENE)))?"
    r"(?:场\s*次?|シーン|SCENE)\s*[0-9一二三四五六七八九十百]+",
    re.M | re.I,
)

# 尾钩标记：【钩子】/【尾钩】/片尾：/钩子： + 日文【フック】/次回予告： + 英文 [HOOK]/Ending:
TAIL_HOOK_RE = re.compile(
    r"【钩子】|【尾钩】|钩子[：:]|片尾[：:]"
    r"|【フック】|次回予告[：:]"
    r"|\[HOOK\]|Ending[：:]",
    re.I,
)

# 大结局收束标记（按 locale）
FINALE_MARKS = {"zh-CN": "【全剧终】", "ja-JP": "【完】", "en": "[THE END]"}


def finale_mark(locale: str = "zh-CN") -> str:
    return FINALE_MARKS.get(locale, FINALE_MARKS["zh-CN"])


def _first_scene_text(script: str) -> str:
    """取第一场文本（场1 行 → 场2 行前），用于前3秒钩子判定"""
    m = SCENE_RE.search(script)
    if not m:
        return script[:200]
    m2 = SCENE_RE.search(script, m.end())
    seg = script[m.start(): m2.start() if m2 else m.start() + 400]
    return seg[:200]


def check_script(script: str, is_final: bool = False,
                 locale: str = "zh-CN", content_type: str = "short_drama") -> dict:
    """质检剧本正文，返回报告（含 hits 供 refine 定位）

    is_final=True 表示本集为全剧末集：启用第 10 项「大结局收束」检查，
    缺收束标记重扣 25 分并阻断 pass，从而自动触发下游修复通道。
    locale=ja-JP 时启用日文词典与第 11 项「语言一致性」（中文残留硬性检查）；
    content_type=novel 时场次检查放宽为不适用（小说正文无场次结构）。
    """
    is_ja = locale == "ja-JP"
    is_novel = content_type == "novel"

    t_words = loc.JP_TEMPLATE_WORDS if is_ja else TEMPLATE_WORDS
    e_words = loc.JP_EMPTY_ACTIONS if is_ja else EMPTY_ACTIONS
    a_words = loc.JP_ACTION_CLICHE if is_ja else ACTION_CLICHE_WORDS
    h_words = loc.JP_HOOK_WORDS if is_ja else HOOK_WORDS
    b_words = {} if is_ja else BOOKISH_WORDS  # 日文书面词无规则映射，交由 LLM 复审

    hits_t = {w: script.count(w) for w in t_words if w in script}
    hits_e = {w: script.count(w) for w in e_words if w in script}
    narr_n = 0 if is_ja else len(NARRATION_RE.findall(script))
    hits_b = {w: script.count(w) for w in b_words if w in script}
    hits_a = {w: script.count(w) for w in a_words if w in script}
    scene_n = len(SCENE_RE.findall(script))
    has_tail = bool(TAIL_HOOK_RE.search(script))
    open_hook = any(w in _first_scene_text(script) for w in h_words)
    chars = len(re.sub(r"\s", "", script))
    residue = loc.jp_residue_report(script) if is_ja else {"chars": 0, "words": 0, "punct": 0, "samples": []}
    residue_n = residue["chars"] + residue["words"] * 2 + residue["punct"]

    finale_mark_ = finale_mark(locale)
    finale = finale_mark_ in script

    checks, deduct = [], 0

    def add(item, ok, weight, detail):
        nonlocal deduct
        if not ok:
            deduct += weight
        checks.append({"item": item, "ok": ok, "detail": detail})

    t_n = sum(hits_t.values())
    add("模板词/AI味", t_n == 0, 5 * min(t_n, 4) + (2 if t_n > 4 else 0),
        f"命中 {t_n} 处：" + "、".join(f"{w}×{c}" for w, c in hits_t.items()) if t_n else "无残留")

    e_n = sum(hits_e.values())
    add("空话动作", e_n == 0, 5 * min(e_n, 3),
        f"命中 {e_n} 处：" + "、".join(hits_e) if e_n else "动作均可具体拍摄")

    add("万能旁白", narr_n == 0, 5 * min(narr_n, 2),
        f"{narr_n} 处「命运/悄然」式旁白" if narr_n else "无")

    b_n = sum(hits_b.values())
    add("台词口语化", b_n <= 2, 2 * min(b_n, 5),
        f"书面词 {b_n} 处：" + "、".join(hits_b) if b_n else "口语化达标")

    # 动作套话：每词至多1次，超出部分每处扣2分（与 LLM 复审 AI 味检测互为补充）
    over_a = {w: c for w, c in hits_a.items() if c > 1}
    a_over = sum(c - 1 for c in over_a.values())
    add("动作套话频次", a_over == 0, 2 * min(a_over, 5),
        "超频：" + "、".join(f"{w}×{c}" for w, c in over_a.items()) if over_a else "动作描写无套路堆砌")

    if is_novel:
        add("场次≥3（2分钟体量）", True, 0, "小说模式：不适用场次检查")
    else:
        add("场次≥3（2分钟体量）", scene_n >= 3, 15,
            f"{scene_n} 个场次" + ("" if scene_n >= 3 else "，不足 3 场"))

    add("片尾强钩", has_tail, 15, "已有钩子标记" if has_tail else "缺片尾钩子")

    add("前3秒钩子", open_hook, 10, "开场即有冲突/悬念要素" if open_hook else "第一场偏平，缺悬念要素")

    add("体量≥300字", chars >= 300, 10, f"{chars} 字")

    if is_final:
        add("大结局收束", finale, 25,
            f"已有「{finale_mark_}」收束标记" if finale
            else f"末集缺「{finale_mark_}」收束标记（硬性）")

    if is_ja:
        add("语言一致性（中文残留）", residue_n == 0, 8 + 4 * min(residue_n, 4),
            "未检出中文残留" if residue_n == 0
            else "残留：" + "、".join(residue["samples"][:6]))

    score = max(0, 100 - deduct)
    fails = [c["item"] for c in checks if not c["ok"]]
    scene_ok = is_novel or scene_n >= 3
    passed = score >= 80 and scene_ok and has_tail and (finale or not is_final)
    return {
        "score": score,
        "pass": passed,
        "summary": ("全部达标" if not fails else "待修复：" + " · ".join(fails)),
        "checks": checks,
        "hits": {
            "template": hits_t, "empty": hits_e, "bookish": hits_b,
            "action_cliche": hits_a,
            "narration": narr_n, "scenes": scene_n, "tail_hook": has_tail,
            "open_hook": open_hook, "chars": chars, "finale": finale,
            "jp_residue": residue_n,
        },
    }
