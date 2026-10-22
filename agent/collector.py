# -*- coding: utf-8 -*-
"""多源爆款语料采集器

内置源：
- hongguo：红果短剧网页版（modern.js SSR，window._ROUTER_DATA JSON）
- jjwxc×4：晋江文学城 topten.php 四榜（总分7/月度5/季度4/半年6，GBK 表格页，网文源）

扩展源通过 register_adapter(name, fn) 注册；collect() 遍历注册表合并所有
成功源的 items 写入 data/corpus_live.json，由 agent/knowledge.py 合并进
BM25 知识库参与检索与生成。
"""
import json
import hashlib
import re
import time
from datetime import datetime
from html import unescape
from pathlib import Path

import httpx
from .market import normalize_item, normalize_market

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "corpus_live.json"

BASE = "https://hongguoduanju.com"
JJ_BASE = "https://www.jjwxc.net"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
TAB_NAMES = {"all": "热播短剧", "human": "热播真人剧", "comic": "热播漫剧", "ai": "热播AI剧"}

# 每次详情页抓取上限（礼貌抓取，控制耗时）
MAX_DETAILS = 10
DETAIL_DELAY = 0.4


def _get(url: str, retries: int = 2) -> str | None:
    for i in range(retries + 1):
        try:
            r = httpx.get(url, headers=HEADERS, timeout=25, follow_redirects=True)
            if r.status_code == 200:
                return r.text
        except Exception:
            pass
        time.sleep(0.8 * (i + 1))
    return None


def _extract_router_data(html: str) -> dict | None:
    """解析页面中所有 `_ROUTER_DATA = {json}` 赋值点，返回内容最大的一个。"""
    best, best_size = None, -1
    for m in re.finditer(r"_ROUTER_DATA\s*=\s*(?={)", html):
        try:
            data, _ = json.JSONDecoder().raw_decode(html[m.end():])
        except Exception:
            continue
        size = len(json.dumps(data, ensure_ascii=False))
        if size > best_size:
            best, best_size = data, size
    return best


def _walk_dicts(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from _walk_dicts(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk_dicts(v)


def _norm_cats(d: dict) -> list[str]:
    cats = [c.get("name", "") for c in (d.get("category_list") or []) if c.get("name")]
    if not cats:
        tags = [t.get("name") or t for t in (d.get("tag_infos") or []) if isinstance(t, dict) or True]
        cats = [str(t) for t in tags][:3]
    return cats


def parse_homepage(html: str) -> list[dict]:
    """首页：homeSections 4 个分区 × 9 部 + banner 位（带简介）"""
    data = _extract_router_data(html)
    if not data:
        return []
    items, banners = [], {}

    for d in _walk_dicts(data):
        if "bannerList" in d or "mBannerList" in d:
            for b in (d.get("bannerList") or []) + (d.get("mBannerList") or []):
                sid = b.get("series_id")
                if sid and (b.get("series_intro") or b.get("tags")):
                    banners[sid] = b
        hs = d.get("homeSections")
        if isinstance(hs, list):
            for sec in hs:
                tab = sec.get("tab_type", "all")
                for v in sec.get("video_list") or []:
                    items.append({**v, "_tab": tab})

    seen, out = set(), []
    for v in items:
        sid = str(v.get("series_id") or "")
        if not sid or sid in seen:
            continue
        seen.add(sid)
        b = banners.get(sid, {})
        out.append({
            "series_id": sid,
            "title": (v.get("series_title") or b.get("series_name") or "").strip(),
            "intro": (v.get("series_intro") or b.get("series_intro") or "").strip(),
            "categories": _norm_cats(v) or _norm_cats(b),
            "tags": [str(t.get("name") if isinstance(t, dict) else t) for t in (b.get("tags") or []) if t][:6],
            "episodes": int(v.get("episode_cnt") or 0),
            "rank": int(v.get("rank") or 99),
            "tab": v.get("_tab", "all"),
        })
    return out


def parse_detail(html: str) -> dict:
    """详情页：loaderData.* 下的剧信息（简介/题材/主创）"""
    data = _extract_router_data(html)
    if not data:
        return {}
    info = {}
    for d in _walk_dicts(data.get("loaderData", {})):
        if (d.get("series_title") or d.get("series_name")) and (
            d.get("series_intro") or d.get("category_list") or d.get("tag_infos")
        ):
            info = d
            break
    return {
        "intro": (info.get("series_intro") or "").strip(),
        "categories": _norm_cats(info),
        "tags": [str(t.get("name") or t) for t in (info.get("tag_infos") or []) if t][:8],
        "episodes": int(info.get("episode_cnt") or 0),
    }


# ---------- 采集源适配器注册表（扩展接口位①：新平台采集源注册后即可接入） ----------
_ADAPTERS = {}


def register_adapter(name: str, fn):
    """注册采集源适配器：fn(max_details) -> {ok, items, ...}，与 scheduler.register_extension 配套"""
    _ADAPTERS[name] = fn
    return True


def collect(max_details: int = MAX_DETAILS, sources: list[str] | None = None,
            market: str | None = None) -> dict:
    """统一采集入口：遍历注册表所有源（sources 可指定子集），合并 items 写 corpus_live.json

    market="japan"/"china" 时按源名前缀分市场运行（jp_* 前缀为日本源）；
    分市场采集与 corpus_live.json 既有数据合并——只替换目标市场条目，另一市场数据保留
    （对齐 agent.md：中文库与日本库并行、失败来源保留上一版数据）。
    每个适配器返回 {ok, items?, ...}；collect 聚合成功源，按 id 去重后统一落盘。
    返回 {ok, count, sources, updated, elapsed_s}，main.py / scheduler 只依赖 ok。
    """
    t0 = time.time()
    market = normalize_market(market) if market else None
    names = [s for s in (sources or list(_ADAPTERS)) if s in _ADAPTERS]
    if market:
        names = [s for s in names
                 if (s.startswith("jp_")) == (market == "japan")]
    if not names:
        return {"ok": False, "error": "无可用采集源"}
    results, all_items, ok_labels = [], [], []
    for name in names:
        fn = _ADAPTERS[name]
        try:
            r = fn(max_details)
        except Exception as e:
            r = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        r["source"] = name
        results.append(r)
        if r.get("ok") and r.get("items"):
            ok_labels.append(f"{name}({len(r['items'])})")
            all_items.extend(r["items"])
    # 分市场运行：保留其它市场的上一版条目（采集失败源的自然降级）。
    # 全量运行时也保留本轮没有成功返回的市场，避免一次日本源网络失败把
    # 已采集的日本语料从 corpus_live.json 清空。
    prev_items = []
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8"))
            ok_sources = {r.get("source") for r in results if r.get("ok") and r.get("items")}
            ok_markets = {
                ("japan" if str(r.get("source") or "").startswith("jp_") else "china")
                for r in results if r.get("ok") and r.get("items")
            }
            for it in (prev.get("items") or []):
                item_market = normalize_market(it.get("market"))
                source_platform = str(it.get("source_platform") or it.get("platform") or "")
                if market and item_market != market:
                    prev_items.append(it)  # 其它市场数据原样保留
                elif market and source_platform not in ok_sources:
                    # 本轮失败源：保留其上一版条目，同时清理历史遗留的导航/政策页噪声
                    if not _is_noise(str(it.get("title") or ""), str(it.get("source_url") or "")):
                        prev_items.append(it)
                elif not market and (item_market not in ok_markets or source_platform not in ok_sources):
                    # 全量运行只替换本轮成功源，其它市场/失败源继续沿用上一版。
                    if not _is_noise(str(it.get("title") or ""), str(it.get("source_url") or "")):
                        prev_items.append(it)
        except Exception:
            prev_items = []
    all_items.extend(prev_items)
    if not all_items:
        return {"ok": False, "error": "所有源采集失败", "details": results}

    seen, uniq = set(), []
    for it in all_items:
        if it["id"] in seen:
            continue
        seen.add(it["id"])
        uniq.append(it)

    payload = {
        "updated": datetime.now().isoformat(timespec="seconds"),
        "source": "多源: " + ", ".join(ok_labels) + (f" [market={market}]" if market else ""),
        "elapsed_s": round(time.time() - t0, 1),
        "items": uniq,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"ok": True, "count": len(uniq), "sources": results,
            "updated": payload["updated"], "elapsed_s": payload["elapsed_s"]}


def _collect_hongguo(max_details: int = MAX_DETAILS) -> dict:
    """红果短剧源：抓取首页榜单 + 详情页简介，返回知识库 schema items（写盘由 collect 统一）"""
    t0 = time.time()
    html = _get(BASE + "/")
    if not html:
        return {"ok": False, "error": "首页请求失败"}
    raw = parse_homepage(html)
    if not raw:
        return {"ok": False, "error": "首页解析失败：未找到 _ROUTER_DATA"}

    # 详情页补全简介：优先「热播短剧」榜排名靠前者
    raw.sort(key=lambda x: (0 if x["tab"] == "all" else 1, x["rank"]))
    enriched = 0
    for it in raw:
        if enriched >= max_details:
            break
        if it["intro"]:
            continue
        dhtml = _get(f"{BASE}/detail?series_id={it['series_id']}")
        if dhtml:
            d = parse_detail(dhtml)
            if d["intro"]:
                it["intro"] = d["intro"]
                it["categories"] = it["categories"] or d["categories"]
                it["tags"] = it["tags"] or d["tags"]
                it["episodes"] = it["episodes"] or d["episodes"]
                enriched += 1
        time.sleep(DETAIL_DELAY)

    # 映射为知识库 schema（热度由榜内排名推导，标注来源）
    items = []
    for i, it in enumerate(raw):
        cats = it["categories"] or ["短剧"]
        genre = "/".join(cats[:3])
        rank = it["rank"]
        tab_bonus = {"all": 0.0, "human": 6.0, "comic": 12.0, "ai": 18.0}.get(it["tab"], 20.0)
        heat = round(99.9 - (rank - 1) * 1.2 - tab_bonus, 1)
        intro = it["intro"]
        hook = intro.split("。")[0][:60] if intro else ""
        items.append(normalize_item({
            "id": f"hg-live-{it['series_id']}",
            "title": it["title"],
            "genre": genre,
            "platform": "红果短剧",
            "heat": heat,
            "episodes": it["episodes"],
            "logline": intro or f"{genre}题材爆款，红果{TAB_NAMES.get(it['tab'], '热播榜')}第{rank}名，共{it['episodes'] or '?'}集",
            "hook": hook,
            "beats": [],
            "reversal": "",
            "pay_card": "",
            "golden_lines": [],
            "lessons": [],
            "tags": it["tags"] or cats,
            "rank": rank,
            "tab": TAB_NAMES.get(it["tab"], it["tab"]),
            "source_url": f"{BASE}/detail?series_id={it['series_id']}",
            "_live": True,
        }, market="china", content_type="short_drama", source_type="live"))

    payload = {
        "updated": datetime.now().isoformat(timespec="seconds"),
        "source": BASE,
        "elapsed_s": round(time.time() - t0, 1),
        "details_enriched": enriched,
        "items": items,
    }
    return {"ok": True, "count": len(items), "details_enriched": enriched,
            "updated": payload["updated"], "elapsed_s": payload["elapsed_s"],
            "items": items}


# ---------- 晋江文学城（网文源） ----------

def _parse_jjwxc(html: str) -> list[dict]:
    """解析晋江 topten.php 总分榜表格：排名/作者/书名/文案/类型/状态"""
    rows = [r for r in re.findall(r"<tr[^>]*>.*?</tr>", html, re.S)
            if "onebook.php?novelid=" in r]
    out, seen = [], set()
    for row in rows:
        nid = re.search(r'onebook\.php\?novelid=(\d+)', row)
        if not nid:
            continue
        nid = nid.group(1)
        if nid in seen:
            continue
        seen.add(nid)
        # 书名 a 块：title="书名" ... href="onebook.php?novelid=x" rel="文案" ...>书名</a>
        m = re.search(r'title="([^"]{1,60})"[^>]*?href="onebook\.php\?novelid=\d+"'
                      r'(?:[^>]*?rel="([^"]*)")?[^>]*?>([^<]*)</a>', row, re.S)
        title, intro, a_text = "", "", ""
        if m:
            title, intro, a_text = m.group(1).strip(), m.group(2) or "", m.group(3).strip()
            # title 属性可能误填长文案，取较短者当书名
            if len(title) > 30 and a_text:
                title = a_text
        if not title:
            continue
        if intro:
            intro = unescape(re.sub(r"<br\s*/?>", " ", intro))
            intro = re.sub(r"\s+", " ", intro).strip().rstrip(".…")
        author = re.search(r'oneauthor\.php\?authorid=\d+">([^<]+)</a>', row)
        genre = re.search(r"(原创-[^\s<]+)", row)
        status = re.search(r"<font[^>]*>([^<]+)</font>", row)
        out.append({
            "nid": nid,
            "title": title,
            "author": author.group(1).strip() if author else "",
            "intro": intro,
            "genre": genre.group(1).strip() if genre else "网文",
            "status": status.group(1).strip() if status else "",
        })
    return out


def _collect_jjwxc_board(orderstr: str, tab_label: str):
    """晋江多榜工厂：topten.php 各 orderstr 共用同一 GBK 表格解析（7=总分 5=月度 4=季度 6=半年）"""
    def _collect(max_details: int = MAX_DETAILS) -> dict:
        t0 = time.time()
        for i in range(3):
            try:
                r = httpx.get(f"{JJ_BASE}/topten.php?orderstr={orderstr}&t=0", headers=HEADERS,
                              timeout=25, follow_redirects=True)
                if r.status_code == 200:
                    html = r.content.decode("gbk", errors="replace")
                    break
            except Exception:
                pass
            time.sleep(0.8 * (i + 1))
        else:
            html = ""
        if not html:
            return {"ok": False, "error": f"晋江{tab_label}请求失败"}
        rows = _parse_jjwxc(html)
        if not rows:
            return {"ok": False, "error": f"晋江{tab_label}解析失败：未找到榜单行"}

        items = []
        for rank, it in enumerate(rows, 1):
            intro = it["intro"]
            heat = round(99.0 - (rank - 1) * 0.3, 1)  # 200 本网文头部，衰减放缓
            items.append(normalize_item({
                "id": f"jj-{it['nid']}",
                "title": it["title"],
                "genre": it["genre"],
                "platform": "晋江文学城",
                "heat": heat,
                "episodes": 0,
                "author": it["author"],
                "logline": intro[:200] if intro else f"晋江{tab_label}第{rank}名 · {it['author']} · {it['genre']}",
                "hook": intro.split("。")[0][:60] if intro else "",
                "beats": [],
                "reversal": "",
                "pay_card": "",
                "golden_lines": [],
                "lessons": [],
                "tags": [p for p in it["genre"].split("-")] + ([it["status"]] if it["status"] else []),
                "rank": rank,
                "tab": tab_label,
                "source_url": f"{JJ_BASE}/onebook.php?novelid={it['nid']}",
                "_live": True,
            }, market="china", content_type="novel", source_type="live"))
        return {"ok": True, "count": len(items),
                "elapsed_s": round(time.time() - t0, 1), "items": items}
    return _collect


# 模块加载完成：注册内置采集源适配器（新源通过 register_adapter 追加）
register_adapter("hongguo", _collect_hongguo)
register_adapter("jjwxc", _collect_jjwxc_board("7", "网文榜·总分"))
register_adapter("jjwxc_month", _collect_jjwxc_board("5", "网文榜·月度"))
register_adapter("jjwxc_quarter", _collect_jjwxc_board("4", "网文榜·季度"))
register_adapter("jjwxc_half", _collect_jjwxc_board("6", "网文榜·半年"))


# ---------- 日本公开榜单适配器 ----------
# 标题内命中的日本题材关键词（榜单页无标签列时的标签兜底）
# 公开页噪声判定：隐私政策/条款/客服/导航/界面按钮类链接与标题，一律不入库
_NOISE_TITLE_RE = re.compile(
    r"プライバシー|特定商取引|お問い合わせ|会社概要|利用規約|コピーライト|採用情報|"
    r"よくある質問|ランキング|ログイン|公式|お知らせ|ヘルプ|規約|クッキー|定義と例|"
    r"詳しい情報|詳細はこちら|もっと見る|もっと読む|ダウンロード|レビュー|"
    r"イベント|ニュース|最新情報|サポート|お問合せ一覧|新刊作品|新着一覧|配信予定|配信中|^無料|キャンペーン|作品特集|サイトマップ|ギフトコード|資金決済|^総合|^トップ|^著者$|"
    r"^シリーズ$|^レーベル$|^雑誌$|^完結$|^検索$|^一覧$|トップ$")
_NOISE_HREF_RE = re.compile(
    r"privacy|privacypolicy|terms|policy|help|support|faq|contact|company|about|notice|"
    r"tokutei|itunes|play\.google|twitter|x\.com|facebook|instagram|apps\.apple\.com|"
    r"/(rank|search|tag|label|author|category|top|free|magazine|photography|game|"
    r"artworks|practical|shinsho|newliterary|manga-magazine)(/|\?|$)|"
    r"/(tcl|ct|st)\d+|/manga(/|\?|$)|/literature|/light-novels|/comics|/novels", re.I)


def _is_noise(title: str, href: str = "") -> bool:
    if _NOISE_TITLE_RE.search(title or ""):
        return True
    return bool(href and _NOISE_HREF_RE.search(href))


JP_GENRE_KEYWORDS = (
    "悪役令嬢", "転生", "復讐", "ざまぁ", "溺愛", "契約結婚", "偽装結婚", "婚約破棄",
    "異世界", "令嬢", "スローライフ", "経営", "ダンジョン", "最強", "無自覚",
    "恋愛", "ミステリー", "推理", "サスペンス", "BL", "TL", "芸能", "アイドル", "溺愛",
)

JP_SOURCES = {
    "jp_bump": ("https://www.bump.studio/news", "BUMP", "short_drama"),
    "jp_fod_short": ("https://short.fod.fujitv.co.jp/", "FOD SHORT", "short_drama"),
    "jp_dramabox": ("https://apps.apple.com/jp/app/dramabox-%E3%83%89%E3%83%A9%E3%83%9E%E3%83%9C%E3%83%83%E3%82%AF%E3%82%B9-%E3%82%B7%E3%83%A7%E3%83%BC%E3%83%88%E3%83%89%E3%83%A9%E3%83%9E%E8%A6%8B%E6%94%BE%E9%A1%8C/id6445905219", "DramaBox", "short_drama"),
    "jp_line_manga": ("https://manga.line.me/ranking", "LINEマンガ", "manga"),
    "jp_bookwalker": ("https://bookwalker.jp/rank/", "BOOK☆WALKER", "novel"),
    "jp_renta": ("https://renta.papy.co.jp/renta/rankings", "Renta!", "novel"),
}


def _collect_jp_public(name: str, url: str, platform: str, content_type: str):
    """Best-effort parser for public Japanese ranking pages.

    It intentionally extracts only visible title/meta text and source URLs;
    platform-specific parsers can replace this adapter without changing collect().
    Captures anchor hrefs as per-item source_url and uses a ja Accept-Language header.
    """
    headers = {**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"}
    html = None
    for i in range(3):
        try:
            r = httpx.get(url, headers=headers, timeout=25, follow_redirects=True)
            if r.status_code == 200:
                html = r.text
                break
        except Exception:
            pass
        time.sleep(0.8 * (i + 1))
    if not html:
        return {"ok": False, "error": f"{platform} 公開页面请求失败"}
    # 标题链接：捕获 href，生成逐条 source_url（榜单页负责排名/标题/标签/热度）
    link_re = re.compile(r'<a[^>]*href="([^"#]+)"[^>]*>([^<]{2,120})</a>', re.I)
    plain_re = re.compile(r'<h[1-6][^>]*>([^<]{2,120})</h[1-6]>', re.I)
    entries, seen = [], set()

    def _push(href: str, raw_title: str):
        title = unescape(re.sub(r"\s+", " ", raw_title)).strip()
        if title in seen or not re.search(r"[\u3040-\u30ff\u3400-\u9fff]", title):
            return
        # 非内容标题/链接：隐私政策、条款、客服、导航、界面按钮等一律不入库
        if _is_noise(title, href):
            return
        seen.add(title)
        entries.append({"title": title, "href": href})

    for href, raw in link_re.findall(html):
        _push(href, raw)
        if len(entries) >= 50:
            break
    if len(entries) < 10:
        for raw in plain_re.findall(html):
            _push(url, raw)
            if len(entries) >= 50:
                break
    if not entries:
        return {"ok": False, "error": f"{platform} 未解析到公开榜单条目"}
    items = []
    for rank, e in enumerate(entries, 1):
        title = e["title"]
        # 题材标签：标题内命中的日本题材关键词（榜单页无标签列时的兜底）
        tags = [kw for kw in JP_GENRE_KEYWORDS if kw in title][:4]
        href = e["href"]
        if href.startswith("/"):
            base = re.match(r"(https?://[^/]+)", url)
            href = (base.group(1) if base else "") + href
        items.append(normalize_item({
            "id": f"{name}-{rank}-{hashlib.md5(title.encode('utf-8')).hexdigest()[:10]}", "title": title,
            "platform": platform, "source_platform": name,
            "rank": rank, "heat": round(99.9 - (rank - 1) * 1.2, 1),
            "episodes": 0, "logline": title, "hook": "",
            "tags": tags, "genre": tags[0] if tags else "",
            "source_url": href or url,
            "collected_at": datetime.now().isoformat(timespec="seconds"),
            "_live": True,
        }, market="japan", content_type=content_type, source_type="live"))
    return {"ok": True, "count": len(items), "items": items, "source_url": url}


# ---------- なろう（小説家になろう）官方 API 适配器 ----------
# 官方 JSON 接口（dev.syosetu.com/man/api/），无需解析 HTML，字段含标题/作者/题材码/关键词/梗概/热度
NAROU_API = "https://api.syosetu.com/novelapi/api/"
NAROU_GENRES = {
    0: "未設定", 101: "異世界〔恋愛〕", 102: "現実世界〔恋愛〕",
    201: "ハイファンタジー", 202: "ローファンタジー",
    301: "純文学", 302: "ヒューマンドラマ", 303: "歴史", 304: "推理", 305: "ホラー",
    306: "アクション", 307: "コメディー",
    401: "VRゲーム", 402: "宇宙", 403: "空想科学", 404: "パニック",
    9901: "童話", 9902: "詩", 9903: "エッセイ", 9904: "リプレイ",
    9999: "その他", 9801: "ノンジャンル",
}


def _fetch_json_retry(url: str, headers: dict, tries: int = 3):
    """带重试的 GET→JSON（指数退避），失败返回 None"""
    for i in range(tries):
        try:
            r = httpx.get(url, headers=headers, timeout=25, follow_redirects=True)
            if r.status_code == 200:
                return r.json()
        except Exception:
            pass
        time.sleep(0.8 * (i + 1))
    return None


def _collect_narou_api(max_details: int = 0):
    """なろう公式API：日間ポイントTOP30 + 総合ポイントTOP20（两条榜单互补，去重合并）"""
    headers = {**HEADERS, "User-Agent": "Mozilla/5.0 (compatible; duanju-agent/1.0)",
               "Accept-Language": "ja-JP,ja;q=0.9"}
    items, seen = [], set()
    for order, lim in (("dailypoint", 30), ("totalpoint", 20)):
        rows = _fetch_json_retry(f"{NAROU_API}?out=json&order={order}&lim={lim}", headers)
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue  # 首条 allcount 统计行跳过
            ncode = str(row.get("ncode") or "").strip()
            title = re.sub(r"\s+", " ", str(row.get("title") or "")).strip()
            if not ncode or not title or ncode in seen:
                continue
            seen.add(ncode)
            genre = NAROU_GENRES.get(row.get("genre"), "その他")
            kws = [k for k in str(row.get("keyword") or "").split() if k][:5]
            story = re.sub(r"<[^>]+>|\s+", " ", str(row.get("story") or "")).strip()
            rank = len(items) + 1
            items.append(normalize_item({
                "id": f"jp_narou-{ncode}", "title": title,
                "platform": "小説家になろう", "source_platform": "jp_narou",
                "author": str(row.get("writer") or "")[:60],
                "rank": rank, "heat": round(99.9 - (rank - 1) * 1.2, 1),
                "episodes": 0, "logline": story[:80], "hook": story[:40],
                "genre": genre, "tags": kws or [genre],
                "source_url": f"https://ncode.syosetu.com/{ncode}/",
                "collected_at": datetime.now().isoformat(timespec="seconds"),
                "source_updated_at": str(row.get("general_lastup") or "")[:19],
                "points": {"daily": row.get("daily_point") or 0,
                           "global": row.get("global_point") or 0},
                "_live": True,
            }, market="japan", content_type="novel", source_type="live"))
    if not items:
        return {"ok": False, "error": "なろうAPI 未取得到作品（网络或接口异常）"}
    return {"ok": True, "count": len(items), "items": items,
            "source_url": NAROU_API}


# ---------- カクヨム 首页榜单适配器（/rankings 已下线，改解析首页作品卡） ----------
def _collect_kakuyomu_home(max_details: int = 0):
    """カクヨム トップページ：解析 /works/ 链接 + title 属性（首页含编辑推荐与热门作品）"""
    url = "https://kakuyomu.jp/"
    headers = {**HEADERS, "Accept-Language": "ja-JP,ja;q=0.9"}
    html = None
    for i in range(3):
        try:
            r = httpx.get(url, headers=headers, timeout=25, follow_redirects=True)
            if r.status_code == 200:
                html = r.text
                break
        except Exception:
            pass
        time.sleep(0.8 * (i + 1))
    if not html:
        return {"ok": False, "error": "カクヨム 首页请求失败"}
    # <a title="作品名" href="/works/ID">——title 与 href 属性顺序不定，逐个 <a> 标签内提取
    tag_re = re.compile(r"<a\s+[^>]*>", re.I)
    href_re = re.compile(r'href="(/works/\d+)"')
    title_re = re.compile(r'title="([^"]{2,120})"')
    entries, seen = [], set()
    for tag in tag_re.findall(html):
        hm, tm = href_re.search(tag), title_re.search(tag)
        if not hm or not tm:
            continue
        href, title = hm.group(1), unescape(re.sub(r"\s+", " ", tm.group(1))).strip()
        if not title or title in seen or _is_noise(title, href):
            continue
        seen.add(title)
        entries.append({"title": title, "href": "https://kakuyomu.jp" + href})
        if len(entries) >= 40:
            break
    if not entries:
        return {"ok": False, "error": "カクヨム 未解析到作品条目"}
    items = []
    for rank, e in enumerate(entries, 1):
        tags = [kw for kw in JP_GENRE_KEYWORDS if kw in e["title"]][:4]
        items.append(normalize_item({
            "id": f"jp_kakuyomu-{rank}-{hashlib.md5(e['title'].encode('utf-8')).hexdigest()[:10]}",
            "title": e["title"], "platform": "カクヨム", "source_platform": "jp_kakuyomu",
            "rank": rank, "heat": round(99.9 - (rank - 1) * 1.2, 1),
            "episodes": 0, "logline": e["title"], "hook": "",
            "genre": tags[0] if tags else "", "tags": tags,
            "source_url": e["href"],
            "collected_at": datetime.now().isoformat(timespec="seconds"),
            "_live": True,
        }, market="japan", content_type="novel", source_type="live"))
    return {"ok": True, "count": len(items), "items": items, "source_url": url}


register_adapter("jp_kakuyomu", _collect_kakuyomu_home)
register_adapter("jp_narou", _collect_narou_api)

for _name, (_url, _platform, _kind) in JP_SOURCES.items():
    register_adapter(_name, lambda max_details, n=_name, u=_url, p=_platform, k=_kind:
                     _collect_jp_public(n, u, p, k))


if __name__ == "__main__":
    import sys
    n = int(sys.argv[1]) if len(sys.argv) > 1 else MAX_DETAILS
    r = collect(n)
    print(json.dumps(r, ensure_ascii=False, indent=1, default=str)[:3000])
