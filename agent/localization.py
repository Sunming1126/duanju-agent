# -*- coding: utf-8 -*-
"""多语言提示词与本地化词典层：按 output_locale 提供语言指令、格式规则与残留检测

职责（对齐 agent.md「日本模式要使用自然日语、当地称谓和当地场景」）：
- language_instruction()：各语言写作指令。日语版包含敬语体系、称谓规范（さん/様/先輩/社長）、
  中国式场景→日本场景的改造映射（豪门→財閥/御曹司、岳母寿宴→結納/法事、
  跪地求饶→契約/相続権/社的立場反转），以及禁止中文人名/中文标点/中文成语残留。
- format_rules()：硬性格式规则，结构标记按语言本地化（场N / シーンN / SCENE N）。
- 残留检测词典：日文稿中的简体字/中文标点/中文词残留（quality.py 语言一致性检查用）。
- 单元标记：集/章 ↔ 話/章 ↔ Episode/Chapter，大纲行首、钩子行、大结局标记按语言生成。
"""

# ---------------- 单元与标记 ----------------

# 「第N个单位」的行首格式（大纲行、续写解析共用）
UNIT_LABELS = {
    ("zh-CN", "short_drama"): "第{n}集",
    ("zh-CN", "novel"): "第{n}章",
    ("ja-JP", "short_drama"): "第{n}話",
    ("ja-JP", "novel"): "第{n}章",
    ("en", "short_drama"): "Episode {n}",
    ("en", "novel"): "Chapter {n}",
}

# 兜底单位（manga 等未显式支持的类型按 short_drama 处理）
def unit_label(output_locale: str, content_type: str, n: int) -> str:
    ct = "novel" if content_type == "novel" else "short_drama"
    fmt = UNIT_LABELS.get((output_locale, ct)) or UNIT_LABELS[("zh-CN", ct)]
    return fmt.format(n=n)

# 场次行标记：场1 / シーン1 / SCENE 1（正则见 quality.SCENE_PATTERNS）
SCENE_MARKER = {"zh-CN": "场{n}", "ja-JP": "シーン{n}", "en": "SCENE {n}"}

# 结尾钩子行格式
TAIL_HOOK = {
    "zh-CN": "【钩子】片尾：{text}",
    "ja-JP": "【フック】次回予告：{text}",
    "en": "[HOOK] Ending: {text}",
}

# 大结局收束标记
FINALE_MARK = {"zh-CN": "【全剧终】", "ja-JP": "【完】", "en": "[THE END]"}


def scene_marker(output_locale: str, n: int) -> str:
    return SCENE_MARKER.get(output_locale, SCENE_MARKER["zh-CN"]).format(n=n)


def tail_hook_line(output_locale: str, text: str) -> str:
    return TAIL_HOOK.get(output_locale, TAIL_HOOK["zh-CN"]).format(text=text)


def finale_mark(output_locale: str) -> str:
    return FINALE_MARK.get(output_locale, FINALE_MARK["zh-CN"])


# ---------------- 语言指令（注入 system prompt） ----------------

# 中国式设定 → 日本式设定的改造映射（写进日语指令，防止直译模板）
JP_SCENE_MAP = (
    "场景改造：中国的豪门/寿宴/岳母羞辱/全城下跪式设定必须替换为日本用户熟悉的语境——"
    "豪门→財閥・御曹司・旧家，寿宴羞辱→結納・見合・法事・同窓，当众跪地求饶→"
    "役職・契約・相続権・社会的信用の剥奪や逆転，赘婿→婿養子・入り婿，"
    "全城首富→業界最大手のオーナー。保留爽点结构，但反转手段要落在职位、合同、继承权、"
    "社会的信用与关系逆转上，而不是肉体下跪。"
)

JP_STYLE = (
    "全程使用自然日语，禁止从中文逐句直译。要求："
    "1) 敬语体系正确——对上司/长辈/客户用尊敬語・謙譲語，亲近关系用普通体，不要混用；"
    "2) 称谓自然——さん/様/先生/先輩/社長/部長/お嬢様 按关系使用，人名用日式姓名（例：高橋、佐藤、結月、蓮）；"
    "3) 禁止出现中文人名、中文成语、简体字、中文标点（，？；），标点用 Japanese 句读（、。「」！？）；"
    "4) 台词口语化，像日本人真实对话；旁白用常体。"
) + JP_SCENE_MAP

EN_STYLE = (
    "Write in natural English throughout — never translate Chinese idioms literally. "
    "Use locally understandable relationships (CEO, in-laws, fiancée, senior partner), "
    "natural contractions in dialogue, and Western character names. "
    "Payoff reversals should land on contracts, titles, inheritance or social standing."
)

ZH_STYLE = "使用自然中文。"


def language_instruction(output_locale: str, market: str = "") -> str:
    if market == "japan":
        language = {"ja-JP": JP_STYLE, "en": "Write in natural English; retain Japanese names, honorifics and setting."}.get(output_locale, ZH_STYLE)
        return language + " 目标市场是日本，与输出语言无关。人物、社会关系、学校、职场、地名和制度采用日本语境；不套用龙王、战神、赘婿、修仙、全城下跪或连续打脸模板。冲突和反转来自人物选择、关系、秘密与现实后果。" + JP_SCENE_MAP
    return {"ja-JP": JP_STYLE, "en": EN_STYLE}.get(output_locale, ZH_STYLE)


def default_idea(output_locale: str, market: str = "") -> str:
    if market == "japan":
        return {"ja-JP": "閉店間際の商店街で、元同級生と小さな食堂を立て直す", "en": "Former classmates reunite to save a small diner in a fading Japanese shopping street"}.get(output_locale, "在即将歇业的商店街，与昔日同学一起重建小食堂")
    return {
        "ja-JP": "離婚届を出した日、冷徹な御曹司に出会った",
        "en": "The day she signed the divorce papers, she ran into the company's cold-hearted heir",
    }.get(output_locale, "赘婿隐藏身份是集团总裁，被退婚后一夜摊牌")


def default_hero(output_locale: str, market: str = "") -> str:
    if market == "japan":
        return {"ja-JP": "佐藤結衣、地元に戻った元会社員", "en": "Yui Sato, a former office worker returning to her hometown"}.get(output_locale, "佐藤结衣，返乡重新开始的前公司职员")
    return {
        "ja-JP": "高橋蓮、三年間コキ使われてきた婿養子",
        "en": "Alex Chen, a son-in-law who hid his identity for three years",
    }.get(output_locale, "林凡")


def default_genre(output_locale: str, market: str = "") -> str:
    if market == "japan":
        return "人生再生/恋愛"
    return {"ja-JP": "人生再生/復讐", "en": "Comeback/Revenge"}.get(output_locale, "逆袭/战神")


# ---------------- 硬性格式规则（按语言/内容类型） ----------------

def format_rules(output_locale: str, content_type: str = "short_drama") -> str:
    """单集成稿的硬性格式要求（与 quality.py 的本地化正则一一对应）。

    架说明用中文（模型稳定遵循），结构标记按输出语言本地化。
    """
    is_novel = content_type == "novel"
    sm = SCENE_MARKER.get(output_locale, SCENE_MARKER["zh-CN"])
    th = TAIL_HOOK.get(output_locale, TAIL_HOOK["zh-CN"]).split("：")[0].split(":")[0]
    if output_locale == "ja-JP":
        scene_line = (f"場面行は必ず「{sm.format(n=1)}」で始める（例：{sm.format(n=1)} オフィス・昼）。"
                      "場面行を ** や 【】 で装飾しない")
        dialogue = "セリフ行は「キャラクター（感情）：セリフ」の形式。セリフは口語で、実在の会話のように"
    elif output_locale == "en":
        scene_line = (f"Every scene line must start with \"{sm.format(n=1)}\" (e.g. {sm.format(n=1)} Office, Day). "
                      "Never wrap scene lines in ** or brackets")
        dialogue = "Dialogue lines must follow \"CHARACTER (emotion): line\", spoken and natural"
    else:
        scene_line = f"场次行必须以「{sm.format(n=1)}」开头（如：{sm.format(n=1)} 内景/白天 · 出租屋），禁止 ** 或 【】 包裹场次行"
        dialogue = "台词行格式「角色（情绪）：台词」，台词全部口语化，像真人说话"
    unit_txt = "章/Scene 块" if is_novel else "场/Scene"
    return (
        f"1. 必须恰好 3-4 个{unit_txt}块，总字数 500-900 字；\n"
        f"2. {scene_line}；\n"
        f"3. {dialogue}；\n"
        f"4. 第一块第 2 行必须就是强冲突动作（当众羞辱/意外曝光/极端处境）或直接承接上一单元的钩子，不许铺垫；\n"
        f"5. 结尾最后一行是钩子行，格式为「{th}：<悬念内容>」，<悬念内容>必须写出本单元结尾留下的具体悬念"
        f"（谁/发生了什么/危机何在，25-50字）；禁止照抄或改写格式示例；不许省略；\n"
        f"6. 禁止万能旁白；禁止「就在这时/与此同时/时间仿佛止」式转场，直接用动作衔接；"
        f"禁止直接宣布情绪（写动作：手抖/杯子掉了/后退半步）；\n"
        f"7. 角色名纪律：人物名必须唯一且前后一致，设定中已出现的人名（含亲属称谓）必须沿用原名，"
        f"禁止另创名字、昵称或别名；\n"
        f"8. 动作反套路：程式化动作词每个至多用1次，超频的换具体情境化动作。\n"
        "直接输出正文，不要任何解释。"
    )


# ---------------- 残留检测（quality.py 语言一致性检查用） ----------------

# 简体字特有字形（日文 shinjitai 中不存在的简化字）：出现在日文稿中即判为中文残留。
# 注意排除日文也使用的同形字（如 余/万/京），避免误伤自然日语。
JP_RESIDUE_CHARS = set(
    "们说话门见车贝长发经张岁汉过还这让儿头东岛饭馆厅办务动质纸织组词该调谈谢费贵买"
    "卖简评读续块坏环现产亚严体两丽举义乐习乡争亿从众优传伤佣仓仪价隐类风飞驾驶验"
    "亏赢输轿软轻输进远运连迟边达违迹适选逊递逻遗邓邮邻郑释鉴钓钝钱铁铜银销"
    "锁锅锋错键镜长门闭问闲间闷闻阀队阶际陆陈险随隐难雏雠雾顶项顾颁顿预频颓颜额"
    "风飘饭饮馆驳验骄骇骏验骗骤"
)

# 中文标点（日文不用全角逗号/问号/分号/冒号；数字的「，」忽略不计——按词级判断）
JP_RESIDUE_PUNCT = ("，", "；")

# 常见中文词（日文语境不出现）：出现即强残留信号
JP_RESIDUE_WORDS = (
    "赘婿", "逆袭", "打脸", "爽点", "龙王", "岳母", "豪门", "退婚", "摊牌", "战神",
    "老爷", "少爷", "丫鬟", "太监", "皇帝", "皇上", "臣妾", "本宫", "金銮殿",
    "顿时", "随即", "宛如", "已然", "岂能", "未曾", "须知", "皆是", "乃是",
)

# 日文版模板词/AI 腔（quality.py 模板词检查用）
JP_TEMPLATE_WORDS = (
    "運命の歯車", "かに変わり始める", "誰も知らない", "密かに動き出す",
    "風雲急を告げる", "天命", "気運", "運命のいたずら",
)

# 日文版空话动作（无法拍摄的抽象描述）
JP_EMPTY_ACTIONS = (
    "場の空気が凍りついた", "緊張が走った", "殺気が満ちた", "複雑な表情を浮かべ",
    "態度が一変した空気",
)

# 日文版动作套话（每词至多1次）
JP_ACTION_CLICHE = (
    "不敵な笑みを浮かべた", "拳を握りしめた", "瞳が揺れた", "眉をひそめた",
    "息を呑んだ", "顔が強張った", "指先が震えた",
)

# 日文钩子要素词（前3秒判定）
JP_HOOK_WORDS = (
    "突然", "まさか", "なんと", "突如", "驚くべき", "あれ？", "えっ",
    "知らせ", "届いた", "現れた", "鳴った", "止まった", "違った", "消えた",
    "裏切り", "本物", "残された", "最後の",
)


def jp_residue_report(script: str) -> dict:
    """日文稿中文残留检测： {chars, words, punct, samples}（语言一致性检查用）"""
    chars = sorted({c for c in script if c in JP_RESIDUE_CHARS})
    words = [w for w in JP_RESIDUE_WORDS if w in script]
    punct = [p for p in JP_RESIDUE_PUNCT if p in script]
    return {
        "chars": len(chars),
        "words": len(words),
        "punct": len(punct),
        "samples": (["".join(chars[:12])] if chars else [])
        + words[:6] + punct[:4],
    }


# ---------------- 日本市场题材（前端下拉 / 提示词倾向共用） ----------------

JP_GENRES = (
    "人生再生/恋愛", "悪役令嬢", "転生/やり直し", "ざまぁ/復讐",
    "溺愛/契約結婚", "異世界/スローライフ", "ダンジョン/成長",
    "職場女性/キャリア", "家庭/嫁姑", "ミステリー/推理",
    "地下アイドル/芸能", "BL",
)
