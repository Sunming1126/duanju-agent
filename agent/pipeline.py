# -*- coding: utf-8 -*-
"""剧本生成流水线：LangGraph 风格状态机（线性编排，每节点可检索注入、可兜底）

节点流：创意解析 → 知识检索 → 剧集/章节大纲 →（novel 附加：人物卡、伏笔表）→ 第1集/第1章剧本
       → 内容质检 → 精修改写 → 分场拆解 → 分镜脚本
每个节点通过 emit() 向前端 SSE 推送状态与内容。
生成请求必须显式携带 market / output_locale / content_type（缺省回退中文短剧）。
"""
import json
from . import llm
from .knowledge import get_kb
from . import fallback
from . import quality
from . import refine as refine_mod
from . import llm_review as review_mod
from . import serial as serial_mod
from . import localization as loc
from .market import normalize_market, normalize_locale, normalize_content_type

NODES = [
    ("parse_idea", "创意解析", "提取题材/主角/核心冲突"),
    ("kb_search", "知识检索", "爆款语料 BM25 召回 + 节拍模板"),
    ("outline", "剧集大纲", "逐集梗概 + 钩子设计"),
    ("script", "第1集剧本", "场次 + 台词 + 情绪节拍"),
    ("quality_check", "内容质检", "规则 8 项 + 豆包爆款潜力分 + 隐性 AI 味"),
    ("refine", "精修改写", "去模板词 / 口语化 / 补钩子 / 复检对比"),
    ("scenes", "分场拆解", "结构化场景表"),
    ("storyboard", "分镜脚本", "景别/运镜/时长/音效"),
]

# 日本市场节拍兜底：知识库无同市场语料时注入（避免中文节拍模板污染日本生成）
JP_BEAT_FALLBACK = {
    "悪役令嬢": ["断罪の場で記憶の残滓に気づく", "乙女ゲームの終盤フラグを把握する", "第一の死亡フラグを回避",
               "皇子の関心を引いて立場を逆転", "領地経営で実績を積む", "断罪シーンで逆転の証を提示"],
    "転生": ["死因とともに前世を回想", "異世界でステータスを確認", "チート能力の片鱗に気づく",
            "最初の敵との遭遇と切り抜け", "周囲の期待を裏切る実力提示", "さらに大きな存在に目を付けられる"],
    "人生再生": ["退職/離縁で人生の底辺に立つ", "隠していた才能の姿を現す", "小さな成功で周囲が態度を変える",
              "旧来の人間関係との断絶", "新天地で実力を認められる", "かつて見下した相手と再会"],
    "復讐": ["裏切りの一幕から始まる", "復讐の初手で相手の弱点を突く", "敵の反撃で追い詰められる",
           "隠れた協力者の登場", "証拠を集めて包囲網を狭める", "当面の敵をざまぁにする"],
}


def _jp_beats(genre: str) -> list:
    for key, beats in JP_BEAT_FALLBACK.items():
        if key in genre:
            return beats
    return JP_BEAT_FALLBACK["人生再生"]


async def run_pipeline(req: dict, emit) -> None:
    """req: {idea, genre, hero, episodes, market, output_locale, content_type,
             novel_length?, audience?, worldview?, words_per_chapter?}; emit: async fn(event: dict)"""
    events = []  # 溯源：收集全部事件供 trace.record

    _raw_emit = emit  # 先绑定原始 emit：闭包晚绑定，直接 await emit 会自递归

    async def _emit(event: dict):
        events.append(event)
        await _raw_emit(event)

    emit = _emit
    market = normalize_market(req.get("market"))
    output_locale = normalize_locale(req.get("output_locale"), market)
    content_type = normalize_content_type(req.get("content_type"))
    is_novel = content_type == "novel"
    unit_noun = {"zh-CN": ("集", "章"), "ja-JP": ("話", "章"), "en": ("Episode", "Chapter")}[output_locale]
    unit_word = unit_noun[1] if is_novel else unit_noun[0]
    idea = (req.get("idea") or "").strip() or loc.default_idea(output_locale, market)
    genre = req.get("genre") or loc.default_genre(output_locale, market)
    hero = (req.get("hero") or "").strip() or loc.default_hero(output_locale, market)
    episodes = int(req.get("episodes") or 12)

    parsed = {"logline": idea, "genre": genre, "hero": hero, "episodes": episodes,
              "market": market, "output_locale": output_locale, "content_type": content_type}

    language_instruction = loc.language_instruction(output_locale, market)

    # ---------- 1. 创意解析 ----------
    await emit({"node": "parse_idea", "status": "running"})
    data = await llm.chat_json(
        [
            {"role": "system", "content": f"你是短剧与网络小说策划专家。只输出 JSON。{language_instruction}"},
            {
                "role": "user",
                "content": f"解析{'小说' if is_novel else '短剧'}创意为 JSON：{{\"logline\":\"一句话故事(40字内)\",\"genre\":\"题材标签\",\"hero\":\"主角名/人设\",\"conflict\":\"核心冲突(30字内)\",\"selling_point\":\"爽点卖点(30字内)\"}}\n创意：{idea}\n倾向题材：{genre}\n主角：{hero}",
            },
        ],
        temperature=0.6,
        max_tokens=400,
    )
    if data:
        parsed.update({k: data.get(k, parsed.get(k)) for k in ("logline", "genre", "hero", "conflict", "selling_point")})
    else:
        parsed.update({"conflict": "隐藏身份与当众羞辱的对撞" if not is_novel else "身份隐藏与命运重启的对撞",
                       "selling_point": "马甲揭露+连环打脸" if not is_novel else "世界观展开+步步翻盘",
                       "_engine": "模板兜底"})
    if not data and market == "japan":
        parsed.update({"conflict": {"ja-JP": "秘密と人間関係の葛藤", "en": "A secret tests personal relationships"}.get(output_locale, "秘密与人际关系的冲突"),
                       "selling_point": {"ja-JP": "人物の選択と関係の変化", "en": "Character choices transform relationships"}.get(output_locale, "人物抉择与关系转变")})
    await emit({"node": "parse_idea", "status": "done", "data": parsed})

    # ---------- 2. 知识检索 ----------
    await emit({"node": "kb_search", "status": "running"})
    kb = get_kb()
    hits = kb.search(f"{parsed['genre']} {parsed['logline']} {parsed.get('conflict','')}", top_k=3,
                     market=market, locale=output_locale, content_type=content_type)
    template = kb.beat_template(parsed["genre"], market=market, locale=output_locale,
                                content_type=content_type)
    # 市场隔离：日本市场无同语料节拍时，注入本地化节拍兜底（绝不复用中文节拍）
    if market == "japan" and not template["common_beats"]:
        template["common_beats"] = _jp_beats(parsed["genre"])
        template["_fallback_source"] = "japan_localized_beats"
    await emit({"node": "kb_search", "status": "done", "data": {"hits": hits, "template": template}})

    kb_context = json.dumps(
        {
            "同类爆款": [{"片名": h["title"], "题材": h["genre"], "钩子": h.get("hook", ""),
                     "节拍": h.get("beats") or [], "反转": h.get("reversal", ""),
                     "金句": h.get("golden_lines") or []} for h in hits],
            "节拍模板": template["common_beats"],
            "创作铁律": template["lessons"],
        },
        ensure_ascii=False,
        indent=1,
    )

    # ---------- 3. 大纲（短剧=逐集；小说=章节大纲） ----------
    await emit({"node": "outline", "status": "running"})
    show_n = min(episodes, 8)
    unit_word_prompt = unit_word
    if is_novel:
        audience = str(req.get("audience") or "general")
        novel_length = str(req.get("novel_length") or "long")
        worldview = str(req.get("worldview") or "").strip()
        aud_txt = {"male": "男性向（爽点：成长/战斗/收获/地位逆转）",
                   "female": "女性向（爽点：关系推进/被爱确认/评价逆转）",
                   "general": "一般向"}.get(audience, "一般向")
        len_txt = "长篇连载（每章结尾留推进钩子，主线分卷展开）" if novel_length == "long" \
            else "短篇（单卷收束，节奏更紧凑）"
        outline = await llm.chat(
            [
                {"role": "system", "content": f"你是爆款网络小说编辑，深谙'每章必推进、结尾必钩子'的铁律。{language_instruction} 直接输出大纲正文。每章必须独立一行，行首以「第N章」开头（如：第1章），禁止用 Markdown 粗体、标题符号或【】包裹行首。"},
                {
                    "role": "user",
                    "content": (
                        f"为小说写前{show_n}章的章节大纲（每章1-2句：本章事件+结尾钩子）。\n"
                        f"作品定位：{len_txt}；{aud_txt}\n"
                        + (f"世界观设定（必须严格遵守，不得自相矛盾）：{worldview}\n" if worldview else "")
                        + f"故事：{parsed['logline']}\n主角：{parsed['hero']}\n核心冲突：{parsed.get('conflict','')}\n\n参考知识库（务必借鉴节拍与反转套路，禁止照抄台词）：\n{kb_context}"),
                },
            ],
            temperature=0.85,
            max_tokens=1200,
        )
    else:
        outline = await llm.chat(
            [
                {"role": "system", "content": f"你是爆款短剧编剧，深谙'每集必冲突、结尾必钩子'的铁律。{language_instruction} 直接输出大纲正文。每集必须独立一行，行首以「第N{unit_word}」开头（如：第1{unit_word}），禁止用 Markdown 粗体、标题符号或【】包裹行首。"},
                {
                    "role": "user",
                    "content": f"为短剧写前{show_n}{unit_word}大纲（每{unit_word}1-2句：本{unit_word}事件+结尾钩子）。\n故事：{parsed['logline']}\n主角：{parsed['hero']}\n核心冲突：{parsed.get('conflict','')}\n\n参考知识库（务必借鉴节拍与反转套路，禁止照抄台词）：\n{kb_context}",
                },
            ],
            temperature=0.85,
            max_tokens=1200,
        )
    if not outline:
        outline = fallback.fallback_outline(parsed["logline"], parsed["genre"], parsed["hero"], show_n,
                                            output_locale=output_locale, content_type=content_type, market=market)
        await emit({"node": "outline", "status": "running",
                    "data": {"note": "大纲 LLM 调用失败，本剧使用模板兜底大纲（建议检查 LLM 配置/额度）"}})
    await emit({"node": "outline", "status": "done",
                "data": {"text": outline, "episodes_planned": show_n}})

    # ---------- 3b. 小说模式：人物卡 + 伏笔表 ----------
    if is_novel:
        await emit({"node": "characters", "status": "running"})
        cards = await llm.chat_json(
            [
                {"role": "system", "content": f"你是小说人物设定师。只输出 JSON。{language_instruction}"},
                {"role": "user", "content": (
                    "为以下小说生成 3-5 张人物卡 JSON："
                    "{\"characters\":[{\"name\":\"姓名\",\"role\":\"主角/对手/盟友/恋爱对象\",\""
                    "profile\":\"身份与性格(40字内)\",\"motivation\":\"核心动机\",\"arc\":\"本卷成长弧线\"}]}。"
                    f"\n故事：{parsed['logline']}\n主角：{parsed['hero']}\n"
                    + (f"世界观：{req.get('worldview','')}\n" if req.get("worldview") else "")
                    + f"大纲：\n{outline[:800]}")},
            ],
            temperature=0.7,
            max_tokens=1200,
        )
        if not cards or not cards.get("characters"):
            cards = {"characters": [{"name": parsed["hero"][:20], "role": "主角",
                                     "profile": parsed["logline"][:40], "motivation": parsed.get("conflict", ""),
                                     "arc": "从被压制到完成逆袭", "_fallback": True}]}
        await emit({"node": "characters", "status": "done", "data": cards})

        await emit({"node": "foreshadows", "status": "running"})
        fores = await llm.chat_json(
            [
                {"role": "system", "content": f"你是小说伏笔管理员。只输出 JSON。{language_instruction}"},
                {"role": "user", "content": (
                    "基于大纲生成伏笔表 JSON：{\"foreshadows\":[{\"id\":\"F1\",\"setup\":\"在第几章埋下+伏笔内容(30字内)\","
                    "\"payoff\":\"在第几章回收+回收方式(30字内)\"}]}，给出 4-6 条关键伏笔（身世/道具/承诺/误会），"
                    "保证全部在主线内回收。\n大纲：\n" + outline[:900])},
            ],
            temperature=0.6,
            max_tokens=900,
        )
        if not fores or not fores.get("foreshadows"):
            fores = {"foreshadows": [{"id": "F1", "setup": f"第1章埋下：{parsed.get('conflict','')[:30]}",
                                      "payoff": f"第{max(episodes, 2)}章回收：真相揭晓，完成反转", "_fallback": True}]}
        await emit({"node": "foreshadows", "status": "done", "data": fores})

    # ---------- 4. 第1集/第1章剧本 ----------
    await emit({"node": "script", "status": "running"})
    unit_prompt = unit_word if not is_novel else "章"
    kind_txt = "网络小说" if is_novel else "竖屏短剧"
    script = await llm.chat(
        [
            {"role": "system", "content": (
                f"你是爆款{kind_txt}编剧，写第1{unit_prompt}完整内容。{language_instruction} 硬性格式要求：\n"
                + loc.format_rules(output_locale, content_type))},
            {
                "role": "user",
                "content": (f"写第1{unit_prompt}{ '（读者试读章，决定追读率）' if is_novel else '剧本' }。\n"
                            f"原始创意（必须完整体现其中全部关键细节与反转）：{idea}\n故事概要：{parsed['logline']}\n主角：{parsed['hero']}\n核心冲突：{parsed.get('conflict','')}\n爽点：{parsed.get('selling_point','')}\n大纲第1{unit_prompt}：{outline.splitlines()[0] if outline else ''}\n\n参考同类爆款钩子：\n{kb_context[:1200]}"),
            },
        ],
        temperature=0.9,
        max_tokens=2400,
    )
    if not script:
        script = fallback.fallback_script(parsed["logline"], parsed["genre"], parsed["hero"],
                                          output_locale=output_locale, content_type=content_type, market=market)
        await emit({"node": "script", "status": "running",
                    "data": {"note": "第1集 LLM 调用失败，使用模板兜底稿（建议检查 LLM 配置/额度）"}})
    await emit({"node": "script", "status": "done", "data": {"text": script}})

    # ---------- 5. 内容质检（规则项 + LLM 潜力分/隐性AI味双层，LLM 失败降级纯规则） ----------
    await emit({"node": "quality_check", "status": "running"})
    qc = quality.check_script(script, locale=output_locale, content_type=content_type)
    qc["llm_review"] = await review_mod.review(script, parsed, output_locale=output_locale)
    # 复审门：第1集复审低于阈值同样整体重写一轮（与 serial._review_gate 同阈值同原则）
    rv = qc.get("llm_review") or {}
    rv_s = (rv.get("potential") or {}).get("score") or rv.get("score")
    if isinstance(rv_s, (int, float)) and rv_s < serial_mod.REVIEW_REWRITE_BELOW:
        await emit({"node": "quality_check", "status": "running",
                    "data": {"note": f"第1集复审仅 {rv_s} 分，低于 {serial_mod.REVIEW_REWRITE_BELOW}，触发重写"}})
        rw = await llm.chat(
            [
                {"role": "system", "content": serial_mod.system_rules(output_locale, content_type, market)},
                {"role": "user", "content": serial_mod._rewrite_prompt(
                    script, rv, 1, outline.splitlines()[0] if outline else "", "",
                    output_locale=output_locale, content_type=content_type)},
            ],
            temperature=0.9,
            max_tokens=2400,
        )
        if rw:
            rw = rw.strip()
            qc2 = quality.check_script(rw, locale=output_locale, content_type=content_type)
            rv2 = await review_mod.review(rw, parsed, output_locale=output_locale)
            rv2_s = ((rv2 or {}).get("potential") or {}).get("score") or (rv2 or {}).get("score") or 0
            # 复审更优且规则质检不降才采纳
            scene_ok = qc2["hits"]["scenes"] >= 3 or content_type == "novel"
            if scene_ok and qc2["score"] >= qc["score"] and rv2_s > rv_s:
                script, qc = rw, qc2
                qc["llm_review"] = rv2
    await emit({"node": "quality_check", "status": "done", "data": qc})

    # ---------- 6. 精修改写（去AI味/口语化/补钩子，含复检对比） ----------
    await emit({"node": "refine", "status": "running"})
    script, refine_data = await refine_mod.refine_script(script, parsed, qc,
                                                         output_locale=output_locale,
                                                         content_type=content_type)
    await emit({"node": "refine", "status": "done", "data": refine_data})

    # ---------- 7. 分场拆解 ----------
    await emit({"node": "scenes", "status": "running"})
    scenes = await llm.chat_json(
        [
            {"role": "system", "content": "你是剧本拆解引擎。只输出 JSON。" + language_instruction},
            {
                "role": "user",
                "content": f"将以下剧本拆为场景表 JSON：{{\"scenes\":[{{\"no\":1,\"location\":\"地点\",\"time\":\"日/夜\",\"characters\":[\"角色\"],\"summary\":\"一句话\"}}]}}\n剧本：\n{script[:2500]}",
            },
        ],
        temperature=0.3,
        max_tokens=900,
    )
    if not scenes or not scenes.get("scenes"):
        scenes = fallback.fallback_scenes(parsed["logline"], parsed["genre"], parsed["hero"], output_locale=output_locale, market=market)
    await emit({"node": "scenes", "status": "done", "data": scenes})

    # ---------- 8. 分镜脚本 ----------
    await emit({"node": "storyboard", "status": "running"})
    first_scene = scenes["scenes"][0] if scenes.get("scenes") else {}
    sb = await llm.chat_json(
        [
            {"role": "system", "content": "你是短剧分镜师。只输出 JSON。" + language_instruction},
            {
                "role": "user",
                "content": f"针对第1场拆出 5-6 个分镜 JSON：{{\"shots\":[{{\"no\":1,\"type\":\"景别(特写/近景/中景/全景)\",\"camera\":\"运镜\",\"duration\":\"3s\",\"desc\":\"画面内容\",\"line\":\"台词/无\",\"sound\":\"音效/BGM\"}}]}}\n场景：{json.dumps(first_scene, ensure_ascii=False)}\n剧本参考：{script[:1200]}",
            },
        ],
        temperature=0.5,
        max_tokens=1200,
    )
    if not sb or not sb.get("shots"):
        sb = fallback.fallback_storyboard(parsed["logline"], parsed["genre"], parsed["hero"], output_locale=output_locale, market=market)
    await emit({"node": "storyboard", "status": "done", "data": sb})

    await emit({"node": "_done", "status": "done", "data": {"hero": parsed["hero"], "genre": parsed["genre"]}})

    # ---------- 溯源登记（模块3）：引用节点+权重+图谱注册 ----------
    try:
        from . import trace as trace_mod
        trace_mod.record(req, events, hits)
    except Exception as e:  # 溯源失败不影响生成
        print(f"[trace] 溯源记录失败: {e}")
