"""Shared market, locale, and content-type normalization helpers."""

MARKETS = {"china", "japan", "global"}
LOCALES = {"zh-CN", "en", "ja-JP"}
CONTENT_TYPES = {"short_drama", "novel", "manga", "inspiration"}


def normalize_market(value: str | None) -> str:
    value = str(value or "").strip().lower()
    if value in {"japan", "jp", "ja", "日本", "日本市场"}:
        return "japan"
    if value in {"global", "world", "国际"}:
        return "global"
    return "china"


def normalize_locale(value: str | None, market: str | None = None) -> str:
    value = str(value or "").strip().lower()
    if value in {"ja", "ja-jp", "jp", "日本語", "日本"}:
        return "ja-JP"
    if value in {"en", "en-us", "en-gb", "英语", "英文"}:
        return "en"
    if value in {"zh", "zh-cn", "cn", "中文", "简体中文"}:
        return "zh-CN"
    return "ja-JP" if normalize_market(market) == "japan" else "zh-CN"


def normalize_content_type(value: str | None) -> str:
    value = str(value or "").strip().lower()
    aliases = {"drama": "short_drama", "短剧": "short_drama", "小说": "novel",
               "漫画": "manga", "灵感": "inspiration"}
    value = aliases.get(value, value)
    return value if value in CONTENT_TYPES else "short_drama"


def normalize_item(item: dict, market: str | None = None,
                   content_type: str | None = None, source_type: str | None = None) -> dict:
    """Return a backwards-compatible corpus item with explicit market metadata."""
    out = dict(item or {})
    out.setdefault("id", "")
    out.setdefault("title", "")
    out.setdefault("title_original", out.get("title", ""))
    out.setdefault("title_localized", {})
    out.setdefault("genre", "")
    out.setdefault("tags", [])
    out.setdefault("logline", "")
    out.setdefault("hook", "")
    # 检索/提示词层需要的结构化字段：实时/手动条目可能缺失，统一补默认值
    out.setdefault("beats", [])
    out.setdefault("lessons", [])
    out.setdefault("golden_lines", [])
    out.setdefault("reversal", "")
    out.setdefault("platform", "")
    out["market"] = normalize_market(out.get("market") or market)
    out["locale"] = normalize_locale(out.get("locale"), out["market"])
    out["content_type"] = normalize_content_type(out.get("content_type") or content_type)
    out["source_type"] = str(out.get("source_type") or source_type or
                              ("live" if out.get("_live") else "manual"))
    out.setdefault("source_platform", out.get("platform", ""))
    out.setdefault("collected_at", out.get("updated_at", ""))
    return out


def market_matches(item: dict, market: str | None = "", locale: str | None = "",
                   content_type: str | None = "") -> bool:
    if market and normalize_market(item.get("market")) != normalize_market(market):
        return False
    if locale and normalize_locale(item.get("locale")) != normalize_locale(locale):
        return False
    if content_type and normalize_content_type(item.get("content_type")) != normalize_content_type(content_type):
        return False
    return True

def market_visible(item: dict, market: str | None = "") -> bool:
    """站点级市场可见性：market 为空=不过滤；"common" 实体对所有市场可见；
    缺失 market 字段的旧数据按 normalize_market 默认（→ china）处理。"""
    if not market:
        return True
    m = normalize_market(item.get("market"))
    return m in (normalize_market(market), "common")

