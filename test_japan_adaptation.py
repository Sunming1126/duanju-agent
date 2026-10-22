"""Offline HTTP regressions: no app startup, paid requests or production writes."""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

import main
from agent import localization as loc, converter, fallback, categories

JP = {"id": "jp-test", "market": "japan", "locale": "ja-JP", "content_type": "novel",
      "title": "商店街の約束", "genre": "人生再生/恋愛", "logline": "閉店を前に再会する二人。",
      "hook": "届いた手紙の差出人は誰？", "author": "著者名", "source_platform": "jp_narou",
      "source_url": "https://example.com/story?a=1&b=2", "collected_at": "2026-10-20T00:00:00Z"}
CN = {"id": "cn-test", "market": "china", "title": "龙王归来", "genre": "逆袭/战神"}


def call(method, path, host="juben.onesay.top", **kwargs):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=f"https://{host}") as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(run())


@pytest.fixture
def isolated(monkeypatch, tmp_path):
    root = tmp_path
    (root / "data/library").mkdir(parents=True)
    monkeypatch.setattr(main, "ROOT", root)
    monkeypatch.setattr(main, "get_kb", lambda: SimpleNamespace(items=[JP, CN]))
    for market in ["japan", "china"]:
        (root / f"data/library/{market}.json").write_text(json.dumps({
            "id": market, "title": "Saved script", "script": "actual body", "market": market,
            "kind": "generated", "updated_at": 1, "genre": "saved genre"}))
    return root


def test_list_detail_and_market_boundaries(isolated):
    listed = call("GET", "/api/library").json()["list"]
    assert {x["id"] for x in listed} == {"japan", "corpus-jp-test"}
    for item in listed:
        detail = call("GET", "/api/library/" + item["id"])
        assert detail.status_code == 200
        assert detail.json() == item
    ref = call("GET", "/api/library/corpus-jp-test").json()
    assert ref["script"] == "" and ref["outline"] == JP["logline"]
    assert ref["excerpt"] == JP["hook"] and ref["read_only"]
    assert ref["hero"] == "" and ref["author"] == JP["author"]
    assert ref["source_url"] == JP["source_url"] and ref["updated_at"] == 1792454400
    assert call("DELETE", "/api/library/corpus-jp-test").status_code == 405
    assert call("GET", "/api/library/china").status_code == 404
    assert call("GET", "/api/library/corpus-jp-test", host="jubencn.onesay.top").status_code == 404
    assert call("DELETE", "/api/library/corpus-jp-test", host="jubencn.onesay.top").status_code == 404
    assert call("GET", "/api/library/no-such-item").status_code == 404
    assert call("GET", "/api/library/japan").json()["script"] == "actual body"
    assert [i["id"] for i in call("GET", "/api/library", host="jubencn.onesay.top").json()["list"]] == ["china"]


@pytest.mark.parametrize("reply", [None, [{"logline": "A new Japan story"}]])
def test_ai_spark_never_uses_china_pool(isolated, monkeypatch, reply):
    prompts = []
    async def fake(messages, **kwargs):
        prompts.append(messages[0]["content"])
        return reply
    monkeypatch.setattr(main.llm_mod, "chat_json", fake)
    result = call("POST", "/api/inspire/spark_ai", json={"n": 2, "output_locale": "en"}).json()
    assert result["cards"]
    assert "恶役" not in prompts[0]  # pool retains Japanese genre values
    assert "悪役令嬢" in prompts[0] and "Western character names" not in prompts[0]
    assert "逆袭/战神" not in prompts[0]
    for card in result["cards"]:
        assert card["market"] == "japan" and card["hero"] != JP["author"]
        assert "龙王" not in json.dumps(card, ensure_ascii=False)


def test_import_defaults_and_metadata(isolated):
    for text, expected_genre, hero in [("# Test\nBody", "人生再生/恋愛", ""),
                  ("# 日本作品\n- **ジャンル**：ミステリー/推理\n- **主人公**：佐藤結衣", "ミステリー/推理", "佐藤結衣")]:
        result = call("POST", "/api/library/import", json={"text": text})
        assert result.status_code == 200
        item = call("GET", "/api/library/" + result.json()["id"]).json()
        assert item["genre"] == expected_genre and item["hero"] == hero
        assert item["locale"] == "ja-JP" and item["script"] == text


def test_conversion_saves_hooks_in_site_market(monkeypatch):
    saves = []
    async def fake(*args, **kwargs): return None
    monkeypatch.setattr(converter.llm, "chat_json", fake)
    monkeypatch.setattr(converter.hooks_mod, "create_hook", lambda **kwargs: saves.append(kwargs))
    result = asyncio.run(converter.convert("まさか、あの手紙が届くなんて！", "商店街", market="japan", output_locale="ja-JP"))
    assert result["hooks_saved"] == len(saves) == 1
    assert saves[0]["market"] == "japan"
    assert "打脸" not in json.dumps(result, ensure_ascii=False)


@pytest.mark.parametrize("language", ["zh-CN", "ja-JP", "en"])
def test_market_independent_of_writing_language(language):
    instruction = loc.language_instruction(language, "japan")
    assert "目标市场是日本" in instruction
    assert "Western character names" not in instruction
    assert loc.default_genre(language, "japan") in loc.JP_GENRES
    script = fallback.fallback_script("商店街", "人生再生/恋愛", "佐藤結衣", output_locale=language, market="japan")
    assert not any(word in script for word in ["龙王", "打脸", "城中村", "豪门", "赘婿"])


def test_japan_category_defaults_preserve_saved_edits(monkeypatch, tmp_path):
    path = tmp_path / "categories.json"
    saved = {"id": "genre:jp-1", "market": "japan", "name": "Edited", "archived": True}
    path.write_text(json.dumps({"categories": [saved, {"id": "cn", "name": "龙王"}], "dimensions": []}))
    monkeypatch.setattr(categories, "_DATA", path)
    result = categories.list_categories(market="japan")["categories"]
    assert len(result) == len(loc.JP_GENRES)
    assert result[0] == saved
    assert all(c.get("market") == "japan" for c in result)
    assert len(json.loads(path.read_text())["categories"]) == 2  # read-only, no data overwrite


def test_writer_import_japanese_episode_and_reference(isolated):
    text = '# 作品\n- **ジャンル**：ミステリー/推理\n- **主人公**：佐藤結衣\n- **ログライン**：手紙の謎\n\n### 第1話\nシーン1 商店街\n本文\n\n### 第2話\n続き'
    result = call('POST', '/api/writer/import', json={'text': text, 'output_locale': 'ja-JP'}).json()
    assert result['agg']['ep1_script'] == 'シーン1 商店街\n本文'
    assert result['agg']['story'] == '手紙の謎'
    assert result['episodes'][0]['no'] == 2
    assert result['agg']['genre'] == 'ミステリー/推理'
    reference = '# 作品\n- **一句话故事**：旧信与秘密\n### 剧情资料（参考资料，非正文）\n公开简介'
    result = call('POST', '/api/writer/import', json={'text': reference}).json()
    assert result['agg']['ep1_script'] == ''
    assert result['agg']['card'] == '公开简介'


def test_reference_source_links_are_safe():
    from agent.library import reference_from_corpus
    for url in ['javascript:alert(1)', 'https://[malformed', 'https:///missing-host']:
        assert reference_from_corpus({**JP, 'source_url': url})['source_url'] == ''
