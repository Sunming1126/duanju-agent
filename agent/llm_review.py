# -*- coding: utf-8 -*-
"""质检 LLM 层：爆款潜力分 + 隐性 AI 味语义检测（叠加在规则层之上）

与 quality.check_script（显式词表 + 结构项）互补：
- 潜力分：钩子强度/爽点密度/节奏张力/付费卡点/情绪共鸣 五维打分 → 加权综合
- 隐性 AI 味：超出显式词表的语义级 AI 腔，逐条给出原文引用与改法
按 output_locale 分派评审提示词：日文稿追加日语自然度/日本场景合理性/称谓一致性维度。
LLM 失败返回 None，pipeline 降级为纯规则质检，永不阻塞主流程。
"""
from . import llm

# 潜力分五维权重：钩子最重要，付费卡点次之（短剧靠结尾钩子拉付费）
WEIGHTS = {"hook": 0.30, "cool": 0.20, "pacing": 0.15, "paywall": 0.20, "emotion": 0.15}
DIM_NAMES = {"hook": "钩子强度", "cool": "爽点密度", "pacing": "节奏张力",
             "paywall": "付费卡点", "emotion": "情绪共鸣"}

_PROMPT = """你是短剧爆款评审专家。对下面这集竖屏短剧剧本做两件事：

一、爆款潜力分：五个维度各打 0-100 整数
- hook 钩子强度：前3秒是否冲突/悬念前置，能否当场留住观众
- cool 爽点密度：打脸/反转/情绪爆点是否足够且不拖沓
- pacing 节奏张力：场景切换是否紧凑，有无废戏
- paywall 付费卡点：结尾钩子是否强到让观众想付费看第2集
- emotion 情绪共鸣：观众能否代入主角处境
注意：短剧冲突（打脸/逆袭/豪门恩怨）是正常卖点，不因题材狗血扣分；只有当冲突空洞、悬念缺失时才低分。

二、隐性 AI 味检测：找出词表之外的语义级 AI 腔，特征包括
- 排比/对仗过于工整，真人编剧不会这么写
- 比喻堆砌、意象空洞（滥用"像一把刀""宛如"类）
- 情绪直给：直接宣布情绪而非用动作/台词呈现
- 万能过渡腔：「与此同时」「就在这时」「时间仿佛静止」式偷懒转场
- 台词念稿感：信息量过载、不像真人说话
每条给出 quote（原文引用，20字内）+ why（为何像AI）+ fix（改法）。
宁缺毋滥，没问题 issues 留空数组，不要硬凑。

剧本信息：题材 {genre}，主角 {hero}

剧本：
{script}

只输出 JSON：{{"potential":{{"hook":0,"cool":0,"pacing":0,"paywall":0,"emotion":0,"verdict":"30字内总评"}},"ai_flavor":{{"level":"无/轻/中/重","issues":[{{"quote":"...","why":"...","fix":"..."}}]}}}}"""

# 日文评审：追加日语自然度 / 日本场景合理性 / 称谓一致性（对齐任务书质检清单）
_PROMPT_JA = """あなたは日本のショートドラマ審査専門家です。以下の脚本について2つの評価をしてください。

一、ヒット潜在力スコア：5次元それぞれ 0-100 の整数
- hook フック強度：冒頭3秒で衝突/謎が出ているか、視聴者を留められるか
- cool カタルシス密度：逆転/見せ場/感情の爆発が十分か、ダレていないか
- pacing テンポ：シーン転換が緊密か、無駄な戯れがないか
- paywall 次話ボタン：結末のフックが「次を見たい」と思わせる強さか
- emotion 感情移入：視聴者が主人公の境遇に入り込めるか
注意：逆転・復讐など強いドラマ性は正常なセールスポイントであり、題材のドロドロで減点しない。衝突が空洞で謎が欠けている場合のみ低評価。

二、日本語としての品質チェック（以下の観点で問題を列挙）：
- 日本語の自然さ：中文直訳・硬い表現・不自然な助詞/語順があれば指摘
- 敬語・呼称の一貫性：さん/様/先輩/社長 などの呼称が関係に合っているか、人物間で一貫しているか
- 日本の場面の妥当性：会社/学校/家族/相続 などの設定が日本の文脈で成立するか
- 簡体字・中文語彙・中文句読点（，；）の残留があれば必ず指摘
- 隠れAIっぽさ：整いすぎた対句、空疎な比喩、感情の直告白、定番のつなぎ言葉（「その時」「まさにその瞬間」）、台詞の読み上げ感
各問題は quote（原文引用20字内）+ why（問題の理由）+ fix（修正案）を付す。
問題がなければ issues は空配列。無理に作らない。

脚本情報：ジャンル {genre}、主人公 {hero}

脚本：
{script}

JSONのみ出力：{{"potential":{{"hook":0,"cool":0,"pacing":0,"paywall":0,"emotion":0,"verdict":"30字以内の総評"}},"ai_flavor":{{"level":"無/軽/中/重","issues":[{{"quote":"...","why":"...","fix":"..."}}]}}}}"""

_PROMPT_EN = """You are a short-drama hit-review expert. Evaluate this episode script in two parts.

1. Hit potential: score each dimension 0-100
- hook: does the opening 3 seconds front-load conflict/suspense enough to retain viewers
- cool: are reversals/payoffs plentiful and punchy
- pacing: tight scene transitions, no dead scenes
- paywall: is the ending hook strong enough to make viewers pay for episode 2
- emotion: can viewers empathize with the protagonist
Note: melodramatic conflict is a legitimate selling point; only score low when conflict is hollow or suspense is missing.

2. Latent AI flavor detection: overly neat parallelism, hollow metaphors, emotion stated instead of shown, stock transitions ("Meanwhile", "Just then"), dialogue that reads like a briefing.
Each issue: quote (<=20 chars) + why + fix. Empty issues array if none; do not invent.

Script info: genre {genre}, hero {hero}

Script:
{script}

Output JSON only: {{"potential":{{"hook":0,"cool":0,"pacing":0,"paywall":0,"emotion":0,"verdict":"short verdict"}},"ai_flavor":{{"level":"none/light/medium/heavy","issues":[{{"quote":"...","why":"...","fix":"..."}}]}}}}"""


def _prompt_for(output_locale: str) -> str:
    return {"ja-JP": _PROMPT_JA, "en": _PROMPT_EN}.get(output_locale, _PROMPT)


def _composite(dims: dict) -> int:
    try:
        return round(sum(dims[k] * w for k, w in WEIGHTS.items()))
    except Exception:
        return 50


async def review(script: str, parsed: dict, output_locale: str = "zh-CN") -> dict | None:
    """LLM 评审剧本，返回 {potential, ai_flavor, engine}；失败返回 None"""
    if not script or len(script) < 50:
        return None
    data = await llm.chat_json(
        [
            {"role": "system", "content": "你是短剧剧本评审引擎。只输出 JSON。"},
            {"role": "user", "content": _prompt_for(output_locale).format(
                genre=parsed.get("genre", ""), hero=parsed.get("hero", ""),
                script=script[:2500])},
        ],
        temperature=0.2,
        max_tokens=1500,
    )
    if not data or not isinstance(data.get("potential"), dict):
        return None
    pot = data["potential"]
    try:
        dims = {k: max(0, min(100, int(pot.get(k, 0)))) for k in WEIGHTS}
    except Exception:
        return None
    ai = data.get("ai_flavor") or {}
    issues = [i for i in ai.get("issues", []) if isinstance(i, dict) and i.get("quote")]
    return {
        "potential": {**dims, "score": _composite(dims),
                      "verdict": str(pot.get("verdict", ""))[:40]},
        "ai_flavor": {"level": str(ai.get("level", "轻"))[:2], "issues": issues[:6]},
        "engine": llm.MODEL,
        "locale": output_locale,
    }
