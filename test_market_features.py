import json

from agent.market import (
    normalize_locale,
    normalize_market,
    normalize_content_type,
    normalize_item,
)
from agent.knowledge import _tokenize
from agent.market import market_matches


def test_market_locale_content_normalization():
    assert normalize_locale("ja") == "ja-JP"
    assert normalize_locale("en-US") == "en"
    assert normalize_locale("unknown") == "zh-CN"
    assert normalize_market("japan") == "japan"
    assert normalize_market("日本") == "japan"
    assert normalize_market("unknown") == "china"
    assert normalize_content_type("novel") == "novel"
    assert normalize_content_type("unknown") == "short_drama"


def test_japanese_tokenizer_keeps_meaningful_terms():
    tokens = _tokenize("悪役令嬢の人生やり直しと契約結婚")
    assert "悪役令嬢" in tokens
    assert "契約結婚" in tokens
    assert "人生" in tokens


def test_normalize_item_adds_market_fields_without_overwriting_source():
    item = normalize_item({"id": "jp-1", "title": "人生やり直し", "locale": "ja"},
                          market="japan", content_type="novel", source_type="live")
    assert item["market"] == "japan"
    assert item["locale"] == "ja-JP"
    assert item["content_type"] == "novel"
    assert item["source_type"] == "live"
    assert item["title"] == "人生やり直し"
    assert item["title_original"] == "人生やり直し"
    assert item["tags"] == []


def test_market_filters_are_market_safe():
    jp = {"market": "japan", "locale": "ja-JP", "content_type": "novel"}
    assert market_matches(jp, market="japan", locale="ja-JP", content_type="novel")
    assert not market_matches(jp, market="china")
