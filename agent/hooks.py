# -*- coding: utf-8 -*-
"""模块4：钩子元素管理 — 分类体系 + 属性标准 + 版本管理 + 审核 + 图谱关联

钩子三属性标准：position(open/mid/tail) × mechanism(悬念/危机/反差/期待/金句) × intensity(1-5)
状态机：auto_pass / pending → approved / rejected
版本管理：每次编辑 push versions[{v, text, edited_at, note}]
"""
import json
import re
import threading
from datetime import datetime
from pathlib import Path

from . import graph as graph_mod
from .market import market_visible

_DATA = Path(__file__).resolve().parent.parent / "data" / "hooks.json"
_LOCK = threading.RLock()

CATEGORIES = ["金句钩", "悬念钩", "危机钩", "期待钩", "标题钩", "反转钩", "身份钩"]
POSITIONS = ["open", "mid", "tail"]
MECHANISMS = ["悬念", "危机", "反差", "期待", "金句"]

SEED_PREFIX = "hook:seed-v2-"

# 种子库 v2：32 条真实可拍钩子，7 类别均衡（悬念3/金句5/期待5/标题4/危机5/反转5/身份5），
# 补齐现有库反转钩/身份钩为 0、金句/标题/危机钩各仅 1 条的失衡，全部预审 approved
_SEEDS = [
    # 悬念钩 ×3
    {"name": "负三层电梯", "text": "电梯在负三层突然停了，灯一闪一灭，手机屏幕亮起：距离通知所有人，还有60秒",
     "category": "悬念钩", "position": "open", "mechanism": "悬念", "intensity": 4, "tags": ["密闭空间", "倒计时"]},
    {"name": "备注home的号码", "text": "她翻出丈夫的旧手机，通讯录里存着一个备注为「home」的号码——拨通后，响铃的是家里的座机",
     "category": "悬念钩", "position": "open", "mechanism": "悬念", "intensity": 4, "tags": ["家庭悬疑"]},
    {"name": "同一个人两处画面", "text": "直播镜头前他笑着挥手，导播间的监控画面里，同一时间、同一个他，正站在天台边缘",
     "category": "悬念钩", "position": "open", "mechanism": "悬念", "intensity": 5, "tags": ["双线叙事", "直播"]},
    # 金句钩 ×5
    {"name": "跪着的人记得脸", "text": "「跪着的人看不清路，但记得住每一张脸。」",
     "category": "金句钩", "position": "open", "mechanism": "金句", "intensity": 3, "tags": ["金句", "逆袭"]},
    {"name": "从来没走", "text": "「我不是回来了，我是从来没走。」",
     "category": "金句钩", "position": "tail", "mechanism": "金句", "intensity": 4, "tags": ["金句", "回归"]},
    {"name": "替我看一眼山顶", "text": "「你们踩着我上去的时候，麻烦替我看一眼山顶的风景。」",
     "category": "金句钩", "position": "tail", "mechanism": "金句", "intensity": 4, "tags": ["金句", "隐忍"]},
    {"name": "谁也不求了", "text": "「我这辈子只求过两次人，一次都没成——所以现在，我谁也不求了。」",
     "category": "金句钩", "position": "open", "mechanism": "金句", "intensity": 4, "tags": ["金句", "觉醒"]},
    {"name": "没教我忍完之后", "text": "「爸，你教我忍，可你没教我，忍完了该怎么办。」",
     "category": "金句钩", "position": "mid", "mechanism": "金句", "intensity": 4, "tags": ["金句", "父子"]},
    # 期待钩 ×5
    {"name": "对面上班的大厦", "text": "她把辞职信拍在桌上，转身走进对面那栋她即将全资收购的大厦",
     "category": "期待钩", "position": "tail", "mechanism": "期待", "intensity": 4, "tags": ["逆袭", "爽点"]},
    {"name": "本该忌口的酒", "text": "体检报告折起来塞进抽屉最深处，他笑着一口气喝下那杯本该忌口的酒",
     "category": "期待钩", "position": "mid", "mechanism": "期待", "intensity": 3, "tags": ["隐忍", "铺垫"]},
    {"name": "改名字的请柬", "text": "婚礼请柬上的新郎名字被划掉，改成了另一个——全场哗然",
     "category": "期待钩", "position": "tail", "mechanism": "期待", "intensity": 4, "tags": ["婚礼", "宣告"]},
    {"name": "死去三年的人", "text": "蒙眼布摘下的瞬间，她看见了那个「死去三年」的人，正站在擂台对面",
     "category": "期待钩", "position": "open", "mechanism": "期待", "intensity": 5, "tags": ["重逢", "对峙"]},
    {"name": "隐藏结局解锁", "text": "系统面板亮起：【提前完成主线，隐藏结局已解锁】",
     "category": "期待钩", "position": "tail", "mechanism": "期待", "intensity": 4, "tags": ["系统流"]},
    # 标题钩 ×4
    {"name": "他还没死", "text": "黑屏白字打出五个字：「他还没死。」",
     "category": "标题钩", "position": "open", "mechanism": "悬念", "intensity": 4, "tags": ["字幕卡", "开场"]},
    {"name": "扫地出门三年", "text": "字幕卡：「三年前，她被全家扫地出门。」——下一秒，警车停在豪宅门口",
     "category": "标题钩", "position": "open", "mechanism": "反差", "intensity": 4, "tags": ["字幕卡", "复仇"]},
    {"name": "改编自真实事件", "text": "片头字幕：「本剧改编自真实事件」，画面里男人平静地撕掉了离婚协议",
     "category": "标题钩", "position": "open", "mechanism": "悬念", "intensity": 3, "tags": ["字幕卡", "真实感"]},
    {"name": "悬赏一个亿", "text": "大字报砸屏：「悬赏一个亿，寻找这个女人」——照片上的人正在收银台打工",
     "category": "标题钩", "position": "open", "mechanism": "反差", "intensity": 5, "tags": ["字幕卡", "身份反差"]},
    # 危机钩 ×5
    {"name": "最后十五分钟", "text": "氧气只剩最后15分钟，而对讲机里传来女儿的哭声",
     "category": "危机钩", "position": "open", "mechanism": "危机", "intensity": 5, "tags": ["生死营救", "倒计时"]},
    {"name": "明早八点过户", "text": "债主把钥匙扔进火锅：「明早八点，房子过户。」他低头看了一眼怀里发烧的孩子",
     "category": "危机钩", "position": "open", "mechanism": "危机", "intensity": 4, "tags": ["债务", "父爱"]},
    {"name": "家属去哪了", "text": "手术室外红灯亮起，医生跑出来喊：「家属呢？家属去哪了！」",
     "category": "危机钩", "position": "open", "mechanism": "危机", "intensity": 4, "tags": ["医疗", "抢救"]},
    {"name": "数到三", "text": "子弹上膛的声音从背后传来：「把东西交出来，我数到三。」",
     "category": "危机钩", "position": "mid", "mechanism": "危机", "intensity": 4, "tags": ["胁迫", "枪战"]},
    {"name": "对岸熄灭的灯", "text": "洪水漫过桥面那一刻，大巴车的灯光在对岸熄灭了",
     "category": "危机钩", "position": "mid", "mechanism": "危机", "intensity": 4, "tags": ["灾难", "失联"]},
    # 反转钩 ×5
    {"name": "该道歉的是你们", "text": "全场以为她要下跪道歉，她却掏出了DNA报告：「该道歉的，是你们全家。」",
     "category": "反转钩", "position": "tail", "mechanism": "反差", "intensity": 5, "tags": ["反转", "打脸"]},
    {"name": "死者走进警局", "text": "凶手自首了。可死者三分钟后，活生生走进了警局",
     "category": "反转钩", "position": "tail", "mechanism": "反差", "intensity": 5, "tags": ["反转", "悬疑"]},
    {"name": "推他下水的手", "text": "他一直以为自己在救她，直到监控回放里，推他下水的正是那双手",
     "category": "反转钩", "position": "mid", "mechanism": "反差", "intensity": 4, "tags": ["反转", "背叛"]},
    {"name": "去世的未婚妻", "text": "新郎掀开红盖头——坐在里面的人，是他「去世」的未婚妻",
     "category": "反转钩", "position": "open", "mechanism": "反差", "intensity": 5, "tags": ["反转", "婚礼"]},
    {"name": "自己都不记得的视频", "text": "庆功宴上他举起奖杯，大屏幕却切出了一段他自己都不记得的视频",
     "category": "反转钩", "position": "tail", "mechanism": "反差", "intensity": 4, "tags": ["反转", "失忆"]},
    # 身份钩 ×5
    {"name": "董事长好", "text": "保洁阿姨摘下工牌，会议室里所有人都站了起来：「董事长好。」",
     "category": "身份钩", "position": "open", "mechanism": "反差", "intensity": 5, "tags": ["隐藏身份", "打脸"]},
    {"name": "外卖箱里的名片", "text": "外卖箱夹层里那张烫金名片，让谈判桌上的总裁连夜改了机票",
     "category": "身份钩", "position": "mid", "mechanism": "反差", "intensity": 4, "tags": ["隐藏身份", "商战"]},
    {"name": "龙纹玉佩", "text": "「你只是一只人人喊打的过街老鼠。」她笑了，袖口滑出半块龙纹玉佩",
     "category": "身份钩", "position": "open", "mechanism": "反差", "intensity": 4, "tags": ["隐藏身份", "信物"]},
    {"name": "父亲职业一栏", "text": "孩子幼儿园报名表「父亲职业」一栏，他犹豫很久，写下：退休。",
     "category": "身份钩", "position": "open", "mechanism": "悬念", "intensity": 3, "tags": ["隐藏身份", "温情"]},
    {"name": "车头的徽标", "text": "全场哄笑中，司机推门下车，车头的徽标让笑声戛然而止",
     "category": "身份钩", "position": "mid", "mechanism": "反差", "intensity": 4, "tags": ["隐藏身份", "排面"]},
]


def _load():
    with open(_DATA, "r", encoding="utf-8") as f:
        d = json.load(f)
    for h in d.get("hooks", []):
        h.setdefault("market", "china")  # 历史钩子全为中文内容，缺省归中国市场
    return d


def _save(d):
    with open(_DATA, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


def _slug(s):
    return re.sub(r"[\s/\\]+", "", s or "")[:20] or "x"


def _sync_graph(h):
    """钩子 ↔ 知识图谱关联：upsert hook 实体并维护与来源剧的 uses 关系"""
    g = graph_mod.get_graph()
    e = g.upsert_entity(h.get("graph_entity") or f"hook:{_slug(h['id'].split(':',1)[-1])}",
                        "hook", h["name"],
                        props={"text": h["text"], "category": h.get("category"),
                               "position": h.get("position"), "mechanism": h.get("mechanism"),
                               "intensity": h.get("intensity"), "tags": h.get("tags", []),
                               "from_hooks_lib": True},
                        confidence=0.95 if h.get("status") == "approved" else 0.5,
                        review="auto_pass" if h.get("status") == "approved" else "pending")
    h["graph_entity"] = e["id"]
    if h.get("source_id"):
        g.upsert_relation(f"drama:{h['source_id']}", e["id"], "uses",
                          weight=float(h.get("intensity", 3)), evidence="钩子库人工/抽取来源")
    g.save()


def get_hook(hid: str):
    """按 id 取单条钩子（详情接口跨市场校验用），不存在返回 None"""
    with _LOCK:
        for h in _load().get("hooks", []):
            if h.get("id") == hid:
                return h
    return None


def list_hooks(status=None, q=None, category=None, market=""):
    with _LOCK:
        d = _load()
        hooks = d["hooks"]
        if market:
            hooks = [h for h in hooks if market_visible(h, market)]
        if status:
            hooks = [h for h in hooks if h.get("status") == status]
        if category:
            hooks = [h for h in hooks if h.get("category") == category]
        if q:
            hooks = [h for h in hooks if q.lower() in json.dumps(h, ensure_ascii=False).lower()]
        return {"count": len(hooks), "taxonomy": {"categories": CATEGORIES, "positions": POSITIONS,
                                                  "mechanisms": MECHANISMS},
                "items": hooks}


def create_hook(name, text, category="悬念钩", position="open", mechanism="悬念",
                intensity=3, tags=None, source_id=None, status="pending", market="china"):
    if mechanism not in MECHANISMS:
        raise ValueError(f"mechanism 必须是 {MECHANISMS}")
    if position not in POSITIONS:
        raise ValueError(f"position 必须是 {POSITIONS}")
    with _LOCK:
        d = _load()
        now = datetime.now().isoformat(timespec="seconds")
        hid = f"hook:lib-{_slug(name)}-{int(datetime.now().timestamp()) % 100000}"
        h = {"id": hid, "name": name, "text": text, "category": category,
             "position": position, "mechanism": mechanism, "intensity": max(1, min(5, int(intensity))),
             "tags": tags or [], "source_id": source_id, "status": status,
             "market": market,
             "graph_entity": None,
             "versions": [{"v": 1, "text": text, "edited_at": now, "note": "创建"}],
             "created_at": now}
        d["hooks"].append(h)
        _save(d)
        _sync_graph(h)
        _save(d)
        return h


def update_hook(hid, text=None, name=None, category=None, position=None,
                mechanism=None, intensity=None, tags=None, note=""):
    """编辑钩子（text 变更自动产生新版本）"""
    with _LOCK:
        d = _load()
        for h in d["hooks"]:
            if h["id"] == hid:
                if name is not None:
                    h["name"] = name
                if category is not None:
                    h["category"] = category
                if position is not None and position in POSITIONS:
                    h["position"] = position
                if mechanism is not None and mechanism in MECHANISMS:
                    h["mechanism"] = mechanism
                if intensity is not None:
                    h["intensity"] = max(1, min(5, int(intensity)))
                if tags is not None:
                    h["tags"] = tags
                if text is not None and text != h["text"]:
                    h["text"] = text
                    h["versions"].append({"v": len(h["versions"]) + 1, "text": text,
                                          "edited_at": datetime.now().isoformat(timespec="seconds"),
                                          "note": note or "编辑"})
                _sync_graph(h)
                _save(d)
                return h
        raise ValueError(f"钩子不存在: {hid}")


def review_hook(hid, approved, reviewer="", note=""):
    """人工审核：approved → auto_pass 升 approved；rejected 出库"""
    with _LOCK:
        d = _load()
        for h in d["hooks"]:
            if h["id"] == hid:
                h["status"] = "approved" if approved else "rejected"
                h["review_note"] = {"reviewer": reviewer, "note": note,
                                    "at": datetime.now().isoformat(timespec="seconds")}
                _sync_graph(h)
                _save(d)
                return h
        raise ValueError(f"钩子不存在: {hid}")


def import_extracted(items, market="china"):
    """智能抽取批量入库（extractor 调用）：去重 → pending 审核队列"""
    added = []
    with _LOCK:
        d = _load()
        have = {h["text"] for h in d["hooks"]}
        for it in items:
            t = (it.get("text") or "").strip()
            if not t or t in have:
                continue
            have.add(t)
            it = dict(it); it.setdefault("market", market)
            now = datetime.now().isoformat(timespec="seconds")
            h = {"id": f"hook:ext-{_slug(it.get('name') or t[:12])}-{int(datetime.now().timestamp()) % 100000}",
                 "name": it.get("name") or t[:24], "text": t,
                 "category": it.get("category") or "悬念钩",
                 "position": it.get("position") if it.get("position") in POSITIONS else "open",
                 "mechanism": it.get("mechanism") if it.get("mechanism") in MECHANISMS else "悬念",
                 "intensity": max(1, min(5, int(it.get("intensity") or 3))),
                 "tags": it.get("tags", []), "source_id": it.get("source_id"),
                 "market": it.get("market", "china"),
                 "status": it.get("status") or "pending", "graph_entity": None,
                 "versions": [{"v": 1, "text": t, "edited_at": now, "note": f"智能抽取(conf={it.get('confidence')})"}],
                 "created_at": now}
            d["hooks"].append(h)
            _sync_graph(h)
            added.append(h)
        if added:
            _save(d)
    return added


def ensure_seed():
    """启动时幂等扩充种子库：按 id 前缀 hook:seed-v2- 判重，已存在不重复添加。
    全部 approved 并同步图谱（confidence 0.95 / review auto_pass），保证配方池可抽。"""
    with _LOCK:
        d = _load()
        have = {h["id"] for h in d["hooks"]}
        added = 0
        now = datetime.now().isoformat(timespec="seconds")
        for i, s in enumerate(_SEEDS, 1):
            hid = f"{SEED_PREFIX}{i:02d}"
            if hid in have:
                continue
            h = {"id": hid, "name": s["name"], "text": s["text"], "category": s["category"],
                 "position": s["position"], "mechanism": s["mechanism"],
                 "intensity": s["intensity"], "tags": s.get("tags", []),
                 "source_id": None, "status": "approved", "graph_entity": None,
                 "versions": [{"v": 1, "text": s["text"], "edited_at": now, "note": "种子库v2预审通过"}],
                 "created_at": now,
                 "review_note": {"reviewer": "system", "note": "种子库预审核通过", "at": now}}
            d["hooks"].append(h)
            _sync_graph(h)
            added += 1
        if added:
            _save(d)
        return {"added": added, "total": len(d["hooks"])}


def bulk_review(ids=None, all_pending=False, approved=True, reviewer="user", note=""):
    """批量审核：ids 指定列表 或 all_pending 全部待审；状态变更同步图谱置信度。"""
    if not ids and not all_pending:
        return {"count": 0, "ids": [], "message": "需提供 ids 或 all_pending=true"}
    with _LOCK:
        d = _load()
        idset = set(ids or [])
        target_status = "approved" if approved else "rejected"
        done = []
        for h in d["hooks"]:
            hit = h["id"] in idset or (all_pending and h.get("status") == "pending")
            if not hit or h.get("status") == target_status:
                continue
            h["status"] = target_status
            h["review_note"] = {"reviewer": reviewer, "note": note or "批量审核",
                                "at": datetime.now().isoformat(timespec="seconds")}
            _sync_graph(h)
            done.append(h["id"])
        if done:
            _save(d)
        return {"count": len(done), "ids": done}
