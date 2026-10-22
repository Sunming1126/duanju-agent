# -*- coding: utf-8 -*-
"""无 LLM 时的模板兜底生成（保证 Demo 永远可运行）

设计原则：
- 六个叙事阶段（铺垫→悬念→首胜→危机→反杀→收尾）各配独立正文，逐集推进、互不重复
- 文案全面避开质检词典（模板词/空话动作/万能旁白/书面腔），兜底稿也能拿到合格分
- 本集大纲行（若有）织入场1，让兜底稿跟随大纲推进而非纯模板
- 3 套场景模板按「创意+题材」哈希轮换，题材化钩子
"""
import hashlib
import re

from . import localization as _loc

BEAT_LIB = {
    "逆袭": ["受辱铺垫", "身份悬念", "第一次打脸", "更大危机", "强势反杀", "尘埃落定"],
    "甜宠": ["初遇误会", "被迫相处", "心动瞬间", "情敌搅局", "误会加深", "甜蜜和解"],
    "复仇": ["含冤而死", "重生归来", "初次布局", "小试牛刀", "仇人反扑", "一网打尽"],
    "悬疑": ["离奇事件", "层层迷雾", "关键线索", "头号嫌疑人", "惊天反转", "真相大白"],
    "穿越": ["穿越错位", "现代金手指", "环境冲突", "小露身手", "树敌招灾", "站稳脚跟"],
    "萌宝": ["天才萌宝登场", "认亲受阻", "初见亲爹", "身份试探", "误会爆发", "真相揭晓"],
    "系统": ["绑定系统", "新手任务", "首次兑换", "招人眼红", "系统危机", "解锁隐藏权限"],
    "重生": ["前世惨死", "重生睁眼", "改变第一步", "仇人试探", "反转打脸", "布局收网"],
}

HOOKS = {
    "逆袭": "{hero}收到一条匿名短信——「你以为的胜利，才刚刚开始」",
    "甜宠": "他突然逼近，声音发哑：「契约到期了……可我舍不得」",
    "复仇": "她摊开手心，仇人当年销毁的证据，此刻正安然躺在掌中",
    "悬疑": "监控里那个人影缓缓回头——屏幕上的脸，竟和{hero}一模一样",
    "穿越": "圣旨到：三日后和亲，驸马的名字，竟是他",
    "萌宝": "小团子掏出亲子鉴定报告：「妈咪，那位叔叔和我的基因相似度99.9%」",
    "系统": "系统提示音炸响：【隐藏任务开启——存活倒计时，只剩24小时】",
    "重生": "仇人举杯走近，笑意里藏着刀：「好久不见，老朋友」",
}

# 六个叙事阶段的兜底正文（每集按阶段推进，正文互不相同）。
# {hero} 为插值占位；文案已避开 quality.py 词典（模板词/空话动作/万能旁白/书面腔），
# 场1 首段内含前3秒钩子要素（突然/竟/却/来电），结尾统一「【钩子】片尾：」格式。
STAGES = [
    {  # 阶段1 铺垫：退路被断，隐忍蓄力
        "act1": "{hero}被众人堵在墙角，手机突然弹出转账被退回的提示",
        "drama": [
            ["屏幕的光映着{hero}发白的脸，退回记录格外刺眼。",
             "{hero}（低声）：这笔账，我记下了。",
             "围观者的哄笑声一阵高过一阵。"],
            ["有人把半杯凉水泼在{hero}脚边，镜头全举了起来。",
             "路人甲：就他？还想翻身？",
             "{hero}擦了擦脸，把手机倒扣在桌上，眼神一点点冷下来。"],
            ["深夜，一张旧照片被塞进门缝，背面写着：最后一条退路。",
             "{hero}（盯着照片）：原来是你。",
             "他抬起头，窗外的路灯正一盏盏熄灭。"],
        ],
        "hook": "{hero}把照片翻到背面——一行小字让他瞳孔骤缩",
    },
    {  # 阶段2 悬念：神秘转机出现
        "act1": "深夜一通陌生来电打进来，{hero}犹豫两秒还是接了",
        "drama": [
            ["电话那头只有电流声，三秒后传来一句：想要翻身，明早六点，城南旧仓库。",
             "{hero}（攥紧手机）：你到底是谁？",
             "对方挂断，屏幕上只剩一串没有备注的号码。"],
            ["清晨的仓库铁门虚掩，里面的箱子让{hero}呼吸一滞。",
             "{hero}（低声）：这些东西，怎么会在这里。",
             "身后突然响起脚步声，由远及近。"],
            ["来人摘下帽子，竟是上周羞辱{hero}最狠的那个人。",
             "对方：别误会，我只是来还东西的。",
             "一只旧铁盒推到{hero}面前，锁孔的形状眼熟得可怕。"],
        ],
        "hook": "铁盒打开的瞬间，{hero}僵在原地——里面是他以为早已烧掉的东西",
    },
    {  # 阶段3 首胜：第一次正面回击
        "act1": "众人等着看{hero}出丑，{hero}却气定神闲地走上台",
        "drama": [
            ["笔尖落纸，{hero}签下名字，全场突然安静。",
             "{hero}（放下笔）：现在，轮到我说话了。",
             "对面那人的笑容第一次绷不住了。"],
            ["有人当场翻出旧账发难，却被{hero}一句话堵死。",
             "{hero}：这份协议的补充条款，要我念给大家听吗？",
             "人群哗然，刚才起哄最凶的人悄悄往后退。"],
            ["道贺的电话一个接一个，{hero}却盯着名单最后一行出神。",
             "{hero}（自语）：赢了小的，大的还躲在暗处。",
             "手机震动，一条没有署名的短信跳了出来。"],
        ],
        "hook": "名单最后一行，一个绝不该出现的名字赫然在列",
    },
    {  # 阶段4 危机：得而复失，触底反弹
        "act1": "一夜之间风向突变，{hero}刚拿到的东西突然全被冻结",
        "drama": [
            ["催告短信连环轰炸，{hero}站在楼下仰头看着灯火通明的大楼。",
             "{hero}（冷笑）：动作够快啊。",
             "身后车门拉开，来人递上一份文件。"],
            ["条款苛刻得像最后通牒，落款竟是多年前的老熟人。",
             "{hero}（把文件折好）：想让我跪着签字？",
             "对方：给你二十四小时，这是他的原话。"],
            ["{hero}翻出压箱底的旧手机，拨出一个三年没拨过的号码。",
             "{hero}：我需要动用那个约定了。",
             "电话接通，那头开口的第一个字就让他手一抖。"],
        ],
        "hook": "电话那头：可以帮你，但你得先告诉我——当年你到底看见了什么",
    },
    {  # 阶段5 反杀：真相摊牌，当众清算
        "act1": "清算现场所有镜头对准{hero}，全场就等他当众认错",
        "drama": [
            ["大屏幕突然亮出所谓铁证，台下哗然一片。",
             "{hero}（不慌不忙）：证据不错，可惜只是半份。",
             "全场安静，所有人都盯着{hero}手里的U盘。"],
            ["完整视频播放，风向瞬间倒转，刚才鼓掌最响的人脸色惨白。",
             "{hero}（一步步走近）：现在，谁来告诉我，谁才是笑话？",
             "对面的人腿一软，扶住了桌角。"],
            ["执法车从侧门进场，径直越过{hero}走向对面。",
             "{hero}（整了整衣袖）：这一幕，我等了三年。",
             "人群散去时他回头看了一眼大屏幕，眼神却越来越沉。"],
        ],
        "hook": "真正的操盘手发来一条贺电：恭喜，游戏才到中场",
    },
    {  # 阶段6 收尾：尘埃落定，埋下新篇
        "act1": "风波平息，{hero}独自站上天台，脚下是整座城市的灯火",
        "drama": [
            ["手机不停弹出道歉与求和的消息，{hero}却一条都没回。",
             "{hero}（关掉屏幕）：晚了。",
             "晚风掀起衣角，远处的霓虹依旧闪烁。"],
            ["旧友深夜找上门想聊当年的事，被{hero}轻轻挡了回去。",
             "{hero}：过去的就让它过去，往前看。",
             "对方欲言又止，端起茶杯又放下，最终什么也没说出口。"],
            ["收拾旧物时，一张泛黄的照片从相册里滑落。",
             "{hero}（捡起照片愣住）：这个名字，怎么会出现在这里。",
             "照片背面，一行褪色的字迹若隐若现。"],
        ],
        "hook": "照片上的人，明天就会出现在{hero}面前",
    },
]

# 阶段级事件短语（fallback_outline 每集推进动作，与 STAGES 顺序对齐，不含节拍术语）
STAGE_MOVES = [
    "被逼到墙角，退无可退", "收到神秘转机线索", "首次正面回击得手",
    "既得利益突然被冻结", "当众摊牌，局势翻面", "大局已定，新疑点浮出水面",
    "旧盟友反水，局势再乱", "最终底牌亮出，胜负翻盘",
]

# 3 套场景模板：(时间/内外, 地点, 动作描述)，按创意哈希轮换
SCENE_SETS = [
    [  # A 都市市井
        ("白天/内", "城中村出租屋", "{hero}攥着手机，转账申请刚被原路退回，指尖发白"),
        ("白天/外", "老街大排档", "熟人当众揭短起哄，一盆冷水泼在{hero}脚边"),
        ("黄昏/外", "楼顶天台", "神秘来电响起，对方只说了一句：「时限到了，该收网了」"),
    ],
    [  # B 豪门商战
        ("白天/内", "豪门老宅客厅", "族老分列两侧，{hero}被点名当众认错"),
        ("白天/内", "集团顶层会议室", "竞标现场，{hero}的方案刚一亮出就被质疑"),
        ("夜晚/内", "地下车库", "黑衣人围拢，为首者摘下墨镜——竟是自家管家"),
    ],
    [  # C 古装宅斗
        ("清晨/内", "偏院柴房", "{hero}被罚跪，掌事嬷嬷冷眼旁观"),
        ("午间/外", "府中花园", "贵公子不期而至，一场看似寒暄的试探暗流涌动"),
        ("夜晚/内", "正厅烛光下", "密信摊开，落款竟是{hero}以为早已不在人世的那个人"),
    ],
]


def _short_hero(hero: str) -> str:
    """完整人设描述 → 裸名字：模板正文与人称插值只放名字，
    避免「林晚，24岁，深夜便利店店员，…」整段简介被塞进台词行/动作行"""
    s = (hero or "").strip() or "主角"
    name = re.split(r"[，,、；;：:\s（(【\[—·-]", s)[0].strip()
    return (name or "主角")[:12]


def _pick_beats(genre, n=6):
    for key, beats in BEAT_LIB.items():
        if key in genre:
            return beats[:n]
    if "脑洞" in genre or "金手指" in genre:
        return BEAT_LIB["系统"][:n]
    return BEAT_LIB["逆袭"]


def _pick_set(idea, genre):
    h = hashlib.md5(f"{idea}|{genre}".encode("utf-8")).hexdigest()
    return SCENE_SETS[int(h[:2], 16) % len(SCENE_SETS)]


def _strip_outline_prefix(line: str) -> str:
    """大纲行 → 本集事件句：去掉「第N集/話/章」「【节拍】」前缀与片尾钩子段，织入场1当动作行"""
    s = (line or "").strip().lstrip("-*·• ").strip()
    s = re.sub(r"^第\s*\d+\s*[集話章][:：\s、，]*", "", s)
    s = re.sub(r"^(?:Episode|Chapter)\s*\d+\s*[:：.\s]*", "", s, flags=re.I)
    s = re.sub(r"^【[^】]{0,14}】[:：]?\s*", "", s)
    s = re.sub(r"[。；;]\s*(片尾|结尾).*$", "", s)
    for beats in BEAT_LIB.values():  # 节拍术语不进正文（质检模板词扣分项）
        for w in beats:
            s = s.replace(w, "")
    s = re.sub(r"\s+", " ", s).strip(" ：:，,；;")
    return s[:48]


def fallback_outline(idea, genre, hero, episodes, output_locale="zh-CN", content_type="short_drama", market="china"):
    """模板兜底大纲：每集一个推进动作 + 一个片尾钩子（不内嵌节拍术语）"""
    idea = (idea or "").strip()
    hero = _short_hero(hero)
    try:
        n = min(max(int(episodes or 10), 1), 8)
    except (TypeError, ValueError):
        n = 8
    if output_locale == "ja-JP":
        return _ja_outline(idea, hero, n, content_type)
    if output_locale == "en":
        return _en_outline(idea, hero, n, content_type)
    if market == "japan":
        moves = ["收到与过去有关的消息", "在商店街寻找知情人", "发现朋友隐瞒的约定", "在车站作出艰难选择", "直面误会并承担后果", "重新建立信任"]
        return "\n".join(f"{_loc.unit_label(output_locale, content_type, i + 1)}：围绕「{idea[:30]}」，{hero}{moves[i % len(moves)]}；一封没有署名的信带来新的疑问。" for i in range(n))
    tails = ["埋下身份伏笔", "关键证人浮出水面", "一封信改写走向",
             "镜头定格在半张脸上", "电话那头突然沉默", "有人递来一张旧照片",
             "名单上多出一个名字", "老对手深夜递来和解信"]
    unit = "章" if content_type == "novel" else "集"
    lines = []
    for i in range(n):
        move = STAGE_MOVES[i % len(STAGE_MOVES)]
        lines.append(f"第{i+1}{unit}：围绕「{idea[:12]}」，{hero}{move}；片尾{tails[i % len(tails)]}。")
    return "\n".join(lines)


# ---------- 日文兜底（日本市场 LLM 失败时使用；绝不落中文稿） ----------

STAGE_MOVES_JA = [
    "追い詰められ、退路を断たれる", "謎めいたチャンスが届く", "初めて正面から仕返しに成功する",
    "手にしたものが突然失われる", "すべてを明かし、形勢が逆転する", "勝負は決着したが、新たな疑問が浮上する",
]

TAILS_JA = ["身元を示す手がかりが残される", "重要な証人が姿を現す", "一通の手紙がすべてを変える",
            "画面は半分だけ見えた顔で止まる", "電話の向こうが急に沈黙する", "古い写真が差し出される",
            "名簿にありえない名前が浮かぶ", "宿敵から夜遅く和解の手紙が届く"]

HOOKS_JA = {
    "復讐": "{hero}のもとに匿名メッセージが届く——「あなたの勝利は、まだ始まりに過ぎない」",
    "恋愛": "彼が間近に迫り、声を落とす。「契約は終わりだ……でも、離したくない」",
    "悪役令嬢": "断罪の舞台で、彼女は前世の記憶と一致する一枚のカードを見せる",
    "ミステリー": "監視カメラの人物がゆっくりと振り返る——その顔は{hero}と同じだった",
    "転生": "ステータス画面に、説明のつかない隠し欄が点滅していた",
}

HOOKS_EN = {
    "revenge": "An anonymous text lights up {hero}'s phone — \"Your victory is only the beginning\"",
    "love": "He steps closer, voice low: \"The contract is over... but I can't let go\"",
    "mystery": "The figure on the monitor turns around slowly — the face is identical to {hero}'s",
}

# 三段式兜底正文（循环推进；日语：敬体の地の文＋口語台詞、日本語文点）
STAGES_JA = [
    {  # 阶段1 追い詰められる
        "act1": "{hero}は人混みに囲まれ、スマートフォンに突然振込拒否の通知が弾ける",
        "drama": [
            ["画面の光が蒼白な{hero}の顔を照らす。返却記録がまぶしい。",
             "{hero}（低く）：この勘定、覚えておく。",
             "野次馬の笑い声が一段と高くなる。"],
            ["誰かが冷えた水を{hero}の足元にぶちまける。視線が集まる。",
             "通行人：こいつに逆転できるとでも？",
             "{hero}は顔を拭き、スマホを伏せた。目が少しずつ冷えていく。"],
            ["深夜、古い写真がドアの隙間から滑り込んでくる。裏には「最後の退路」の文字。",
             "{hero}（写真を凝視）：そういうことか。",
             "窓の外で街灯が一つ、また一つと消えていく。"],
        ],
        "hook": "写真を裏返した瞬間、{hero}は息を呑んだ——焼けたはずのものがそこにあった",
    },
    {  # 阶段2 転機
        "act1": "深夜、知らない番号から突然着信が入る。{hero}は二秒迷って出た",
        "drama": [
            ["受話器の向こうはノイズだけで、三秒後に声がした。「這い上がりたければ、明朝六時、南の旧倉庫へ」",
             "{hero}（スマホを握る）：お前は一体誰だ。",
             "通話が切れ、画面には登録されていない番号だけが残る。"],
            ["早朝、倉庫の鉄扉は半開きだった。中の箱に{hero}は息を止めた。",
             "{hero}（呟く）：どうしてこんなものが、ここに。",
             "背後で足音が近づいてくる。"],
            ["来たのは先週、最も辱めた相手だった。",
             "相手：誤解しないでほしい。物を返しに来ただけだ。",
             "古い鉄箱が{hero}の前に押し出される。鍵穴の形に見覚えがあった。"],
        ],
        "hook": "鉄箱が開いた瞬間、{hero}はその場で固まった——中身は消えたはずの証拠そのものだった",
    },
    {  # 阶段3 逆転
        "act1": "大画面にまさかの決定的証拠が映し出され、会場がどよめく",
        "drama": [
            ["{hero}は慌てずポケットからU盤を取り出した。",
             "{hero}（静かに）：いい証拠だ。だが半分だけ、という点が残念だな。",
             "会場が静まり、全員の視線が{hero}の手元に集まる。"],
            ["完全版が再生され、機運が一気に逆流する。拍手を送っていた顔が青ざめる。",
             "{hero}（一歩ずつ近づき）：さあ、どちらが笑いものだったのか、教えてもらおうか。",
             "対面の男は脚から力を失い、机の端にすがった。"],
            ["関係者が側面扉から入場し、{hero}を通り越して対面へ向かう。",
             "{hero}（袖を整え）：この瞬間を、三年待っていた。",
             "人が散っていく中、{hero}は大画面を振り返り、眉を寄せた。"],
        ],
        "hook": "黒幕からのお祝いメッセージが届く——「おめでとう。ゲームはまだ中盤だ」",
    },
]

SCENE_SETS_JA = [
    [("昼/内", "粗末なアパート", "{hero}の手にスマホ。振込拒否の通知がまだ光っている"),
     ("昼/外", "下町の路地", "知り合いに浴びせられた冷水が{hero}の足元で跳ねる"),
     ("夜/内", "ビルの屋上", "知らない番号からの着信。「期限だ。取り返しの時間だ」"),
     ],
    [("昼/内", "老舗の応接間", "親族が両脇に並び、{hero}は居並ぶ面々の前で名を呼ばれる"),
     ("昼/内", "本社の会議室", "提案資料を出した瞬間、席から嘲りの声が上がる"),
     ("夜/内", "地下駐車場", "黒装束の男たちに囲まれる。先頭の男がサングラスを外す——それは執事だった"),
     ],
]


def _short_hero_ja(hero: str) -> str:
    s = (hero or "").strip() or "主人公"
    name = re.split(r"[，,、；;：:\s（(【\[—·-]", s)[0].strip()
    return (name or "主人公")[:12]


def _ja_outline(idea, hero, n, content_type):
    unit = "章" if content_type == "novel" else "話"
    lines = []
    for i in range(n):
        move = STAGE_MOVES_JA[i % len(STAGE_MOVES_JA)]
        tail = TAILS_JA[i % len(TAILS_JA)]
        lines.append(f"第{i+1}{unit}：「{idea[:12]}」——{hero}は{move}。結末で{tail}。")
    return "\n".join(lines)


def _en_outline(idea, hero, n, content_type):
    unit = "Chapter" if content_type == "novel" else "Episode"
    moves = ["is cornered with no way out", "receives a mysterious lifeline",
             "lands a first open counterattack", "suddenly loses what was gained",
             "reveals everything and flips the table", "wins the round, but a new question surfaces"]
    tails = ["a hidden identity clue is left behind", "a key witness steps forward",
             "a letter changes everything", "the shot freezes on half a face",
             "the other end of the call goes silent", "an old photo is handed over"]
    lines = []
    for i in range(n):
        lines.append(f"{unit} {i+1}: Around \"{idea[:40]}\", {hero} {moves[i % len(moves)]}; "
                     f"ending: {tails[i % len(tails)]}.")
    return "\n".join(lines)


def _pick_hook(genre, hero, output_locale="zh-CN", market="china"):
    """题材化钩子（按输出语言分派）"""
    if market == "japan" and output_locale == "zh-CN":
        return f"{hero}收到一封没有署名的信，信里提到的约定，为什么只有旧友知道？"
    if output_locale == "ja-JP":
        h = _short_hero_ja(hero)
        for key, tpl in HOOKS_JA.items():
            if key in genre:
                return tpl.format(hero=h)
        return HOOKS_JA["復讐"].format(hero=h)
    if output_locale == "en":
        h = _short_hero(hero)
        for key, tpl in HOOKS_EN.items():
            if key.lower() in genre.lower():
                return tpl.format(hero=h)
        return HOOKS_EN["revenge"].format(hero=h)
    return _pick_hook_zh(genre, hero)


def _pick_hook_zh(genre, hero):
    hero = _short_hero(hero)
    for key, tpl in HOOKS.items():
        if key in genre:
            return tpl.format(hero=hero)
    return HOOKS["逆袭"].format(hero=hero)


def _scene_setting(output_locale: str, hero: str) -> str:
    """补场次用的场景设定行（按输出语言）"""
    if output_locale == "ja-JP":
        return f"{_short_hero_ja(hero)}の自宅"
    if output_locale == "en":
        return f"{_short_hero(hero)}'s apartment, Night"
    return f"{_short_hero(hero)}住处"


def fallback_script(idea, genre, hero, episode_no=1, line="", output_locale="zh-CN",
                    content_type="short_drama", market="china"):
    """单集兜底稿：正文随集数按叙事阶段推进（每集不同），本集大纲行织入场1。

    locale=ja-JP 使用 STAGES_JA（绝不落中文稿）；en 使用中文场景骨架但结构标记
    本地化（SCENE N / [HOOK]），交由后续精修润色。
    """
    is_novel = content_type == "novel"
    if output_locale == "ja-JP":
        return _ja_script(idea, genre, hero, episode_no, line, is_novel)
    if market == "japan":
        return _japan_translated_scaffold(idea, hero, episode_no, line, output_locale, content_type)
    idx = (int(episode_no or 1) - 1) % len(STAGES)
    stage = STAGES[idx]
    sset = _pick_set(idea, genre)
    h = _short_hero(hero)
    unit = "章" if is_novel else "集"
    head = f"【第{episode_no}{unit}】" + ("" if is_novel else "（时长约2分钟）")
    out = [head, ""]
    for i, (t, loc_, _act) in enumerate(sset, 1):
        # 结构标记按语言本地化（en → SCENE N，结构骨架仍为中文，交由精修润色）
        scene_head = _loc.scene_marker(output_locale, i) if output_locale == "en" else f"场{i}"
        out.append(f"{scene_head} {t} · {loc_}")
        if i == 1:
            out.append(stage["act1"].format(hero=h))
            lead = _strip_outline_prefix(line)
            if lead:
                out.append(lead)
        for ln in stage["drama"][i - 1]:
            out.append(ln.format(hero=h))
        out.append("")
    hook = _pick_hook(genre, hero, output_locale=output_locale) if output_locale != "zh-CN" \
        else stage["hook"].format(hero=h)
    out.append(_loc.tail_hook_line(output_locale, hook) if output_locale != "zh-CN"
               else f"【钩子】片尾：{hook}")
    return "\n".join(out)


def _ja_script(idea, genre, hero, episode_no, line, is_novel):
    """日文兜底稿：三段式循环推进，日语正文 + 日本场景"""
    stages = STAGES_JA
    idx = (int(episode_no or 1) - 1) % len(stages)
    stage = stages[idx]
    sset = SCENE_SETS_JA[int(episode_no or 1) % len(SCENE_SETS_JA)]
    h = _short_hero_ja(hero)
    unit = "章" if is_novel else "話"
    out = [f"【第{episode_no}{unit}】" + ("" if is_novel else "（約2分）"), ""]
    for i, (t, place, _act) in enumerate(sset, 1):
        out.append(f"シーン{i} {t} · {place}")
        if i == 1:
            out.append(stage["act1"].format(hero=h))
            lead = _strip_outline_prefix(line)
            if lead:
                out.append(lead)
        for ln in stage["drama"][i - 1]:
            out.append(ln.format(hero=h))
        out.append("")
    hook = _pick_hook(genre, h, output_locale="ja-JP")
    out.append(_loc.tail_hook_line("ja-JP", hook))
    return "\n".join(out)


def fallback_scenes(idea, genre, hero, output_locale="zh-CN", market="china"):
    if market == "japan" or output_locale != "zh-CN":
        place, day, action = {"ja-JP": ("商店街", "昼", "秘密を知り、選択を迫られる"), "en": ("Shopping street", "Day", "A secret forces a difficult choice")}.get(output_locale, ("商店街", "日", "得知秘密，被迫作出选择"))
        return {"scenes": [{"no": 1, "location": place, "time": day, "characters": [hero], "summary": action}], "_engine": "template"}

    sset = _pick_set(idea, genre)
    h = _short_hero(hero)
    return {
        "scenes": [
            {"no": i, "location": loc, "time": t.split("/")[0],
             "characters": [h] if i == 1 else [h, "对手角色"],
             "summary": act.format(hero=h)}
            for i, (t, loc, act) in enumerate(sset, 1)
        ]
    }


def fallback_storyboard(idea, genre, hero, output_locale="zh-CN", market="china"):
    if market == "japan" or output_locale != "zh-CN":
        shot, camera, desc, sound = {"ja-JP": ("クローズアップ", "固定", "主人公が知らせを読み、表情を変える", "商店街の環境音"), "en": ("Close-up", "Static", "The protagonist reads a message; their expression changes", "Shopping street ambience")}.get(output_locale, ("特写", "固定", "主人公读到消息，神情改变", "商店街环境音"))
        return {"shots": [{"no": 1, "type": shot, "camera": camera, "duration": "3s", "desc": desc, "line": "", "sound": sound}], "_engine": "template"}

    sset = _pick_set(idea, genre)
    h = _short_hero(hero)
    specs = [
        ("特写", "手持缓推", "3s", sset[0][2].format(hero=h), "低频心跳声"),
        ("中景", "环绕", "4s", f"{sset[0][1]}内光线一暗，来人不怀好意", "环境音渐紧"),
        ("近景", "固定", "4s", f"{sset[1][1]}：{sset[1][2].format(hero=h)}", "音效：叮"),
        ("全景", "升降", "5s", f"{sset[2][1]}对峙，剑拔弩张", "BGM 鼓点渐强"),
        ("特写", "慢推", "3s", f"{h}眼神转冷，开口摊牌", "静音一拍后爆点"),
        ("特写", "急推", "2s", "关键信息亮出，画面骤停", "重音收尾"),
    ]
    return {
        "shots": [
            {"no": i, "type": ty, "camera": cam, "duration": du, "desc": de, "sound": so}
            for i, (ty, cam, du, de, so) in enumerate(specs, 1)
        ]
    }


def _japan_translated_scaffold(idea, hero, episode_no, line, locale, content_type):
    """Transparent rule fallback for Japan stories written in Chinese or English."""
    if locale == "en":
        places = ["Shopping street, Day", "Local station, Evening", "Bookshop, Night"]
        actions = [f"{hero} receives an unsigned letter. A familiar name appears in its final line.",
                   f"{hero} asks a former classmate about the letter. The answer contradicts a shared memory.",
                   f"{hero} finds the original envelope. Its postmark reveals that someone nearby knew the truth."]
        hook = "A new message arrives: do not open the shop tomorrow. Who sent the warning?"
        reply = f'{hero} (quietly): I need to hear what happened from you.'
    else:
        places = ["商店街，日", "地方车站，傍晚", "旧书店，夜"]
        actions = [f"{hero}收到一封没有署名的信，末尾出现了熟人的名字。",
                   f"{hero}向昔日同学询问信的来历，对方的回答却与共同的记忆矛盾。",
                   f"{hero}在店里找到旧信封，邮戳显示，身边有人早已知道真相。"]
        hook = "手机收到新消息：明天不要开店。发信人是谁，又为什么知道那封信的下落？"
        reply = f"{hero}（低声）：我想听你亲口说，当年究竟发生了什么。"
    out = [_loc.unit_label(locale, content_type, episode_no), idea, line, ""]
    for i, (place, action) in enumerate(zip(places, actions), 1):
        out.extend([f"{_loc.scene_marker(locale, i)} {place}", action, reply, ""])
    out.append(_loc.tail_hook_line(locale, hook))
    return "\n".join(out)
