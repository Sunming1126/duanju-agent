"""Four-language generation, frozen preferences and corpus boundaries; no live model calls."""
import asyncio
import copy
import json
import uuid

import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient

import studio_main
from agent import studio_api as api
from agent.studio_region import LANGUAGES, REGIONS
from agent.studio_writing import system_prompt, step_instruction
from agent.studio_jobs import JobStore, JobInput, messages_for, execute
from agent.studio_inspiration import InspirationInput, InspirationStore, messages_for as inspiration_messages, parse_result
from agent.studio_outline import combined_outline, rough_preview
from agent.studio_store import StudioStore
from studio_test_scope import browser_scope


@pytest.fixture
def regional_store(tmp_path, monkeypatch):
    store = StudioStore(tmp_path / "regions.sqlite3")
    monkeypatch.setattr(api, "store", store)
    monkeypatch.setattr(api, "reference_context", lambda work: [])
    with browser_scope(studio_main.app):
        yield store


@pytest.mark.parametrize("market,locale", [(m, l) for m in REGIONS for l in LANGUAGES])
@pytest.mark.parametrize("kind", ["novel", "short_drama"])
def test_work_preferences_roundtrip_and_frozen_generation_messages(regional_store, market, locale, kind):
    data = api.WorkInput(title="Original title", content_type=kind, market=market, output_locale=locale,
                         units=1, premise="A key to a community reading room.").model_dump()
    work = regional_store.create_work(data)
    jobs = JobStore(regional_store)
    job = jobs.create(work["id"], JobInput(action="chapter", revision=work["revision"], request_key=str(uuid.uuid4())))
    assert job["snapshot"]["market"] == market and job["snapshot"]["output_locale"] == locale
    # Changing saved preferences cannot alter the already queued paid-call input.
    regional_store.update_work(work["id"], {**data, "output_locale": "en", "market": "global"}, work["revision"])
    assert jobs.get(job["id"])["snapshot"]["output_locale"] == locale
    messages = messages_for(job, {"action": "chapter", "number": 1}, [])
    if locale != "zh-CN" or market != "china":
        assert LANGUAGES[locale] in messages[0]["content"]
        assert REGIONS[market] in messages[0]["content"]
        assert "专业中文" not in messages[0]["content"]
        assert "使用简体中文" not in messages[0]["content"]
    if kind == "novel":
        assert "JSON" in messages[0]["content"]
    assert regional_store.get("works", work["id"])["premise"] == data["premise"]


@pytest.mark.parametrize("market,locale", [("global", "en"), ("japan", "ja-JP"), ("arab", "ar")])
def test_inspiration_preserves_region_and_output_language_during_analysis(market, locale):
    body = InspirationInput(market=market, output_locale=locale, content_type="novel", prompt="A key leads to a reading room.", request_key=str(uuid.uuid4()))
    snapshot = {"input": body.model_dump(), "plans": [{"id": "one", "title": "A key", "summary": "A choice", "story": "A repairer must choose the future of a neighborhood room."}]}
    job = {"snapshot": snapshot, "action": "generate"}
    message = inspiration_messages(job)
    assert LANGUAGES[locale] in message[0]["content"] and REGIONS[market] in message[0]["content"]
    result = {"title": "Original", "genre": "Drama", "premise": "A repairer discovers an unclaimed key and meets its owner.", "audience": "general", "units": 3, "words_per_chapter": 800,
              "creative": {"genres": ["Drama"], "core": ["Community"], "styles": ["Natural"], "highlights": "A practical choice."},
              "world_snapshot": {"name": "Neighborhood", "description": "Contemporary", "sections": {"world_rules": "No magic", "locations": "Shop and reading room"}}}
    parsed = parse_result({**job, "action": "analyze"}, json.dumps(result))
    assert parsed["market"] == market and parsed["output_locale"] == locale


@pytest.mark.parametrize("kind", ["novel", "short_drama"])
def test_localized_outlines_keep_native_prose_and_strict_complete_numbering(kind):
    raw = "[Synopsis]\nA repairer finds a key and asks the neighbors to keep their room open.\n[Units]\n[Unit 1]\nThe key is discovered.\n[Unit 2]\nNeighbors share a practical decision."
    outline = combined_outline(raw, kind, 2)
    assert "The key is discovered." in outline
    assert "第1" not in outline and "第2" not in outline
    assert rough_preview(raw) == "A repairer finds a key and asks the neighbors to keep their room open."
    assert combined_outline(raw.replace("\n", "\r\n"), kind, 2) == outline
    for bad in [raw + "\n[Units]", raw.replace("[Unit 2]", "[Unit 1]"), raw.replace("[Unit 2]", "[Unit 3]"), raw.split("[Unit 2]")[0]]:
        with pytest.raises(ValueError):
            combined_outline(bad, kind, 2)


@pytest.mark.parametrize("kind,text", [("novel", "Mara placed the key on the table. The others watched her hand.\n‘Next month is not paid for,’ she said."), ("short_drama", "INT. READING ROOM - EVENING\nMara sets down the key.\nMARA: Next month is not paid for.")])
def test_regional_job_uses_single_call_and_never_changes_original_before_adoption(regional_store, kind, text):
    work = regional_store.create_work(api.WorkInput(title="The key", content_type=kind, market="global", output_locale="en", units=1, premise="A room needs a future.").model_dump())
    jobs = JobStore(regional_store)
    job = jobs.create(work["id"], JobInput(action="chapter", revision=work["revision"], request_key=str(uuid.uuid4())))
    job = jobs.claim()
    calls = []
    async def generate(messages, **options):
        calls.append(messages)
        return json.dumps({"text": text, "summary": "Mara offers a key and asks for support."})
    asyncio.run(execute(jobs, job, generate))
    finished = jobs.get(job["id"])
    assert finished["status"] == "completed" and len(calls) == 1
    assert finished["results"][0]["text"] == text
    assert regional_store.get("works", work["id"])["chapters"] == []


def test_reference_search_filters_selected_region_and_rejects_cross_region_ids(monkeypatch):
    rows = [{"id": "cn", "market": "china", "locale": "zh-CN", "content_type": "novel", "title": "中文"},
            {"id": "ar", "market": "arab", "locale": "ar", "content_type": "novel", "title": "مفتاح"}]
    calls = []
    class Knowledge:
        items = rows
        def search(self, *args, **kwargs):
            calls.append(kwargs)
            return []
    monkeypatch.setattr(api, "get_kb", lambda: Knowledge())
    work = api.WorkInput(title="Original", content_type="novel", market="arab", output_locale="ar", reference_ids=["cn"]).model_dump()
    with pytest.raises(ValueError, match="selected region"):
        api.reference_context(work)
    work["reference_ids"] = ["ar"]
    assert api.reference_context(work)[0]["id"] == "ar"
    assert calls[-1]["market"] == "arab" and calls[-1]["locale"] == "ar"
    assert [item["id"] for item in api.reference_items("novel", "arab", "ar")] == ["ar"]


def test_unknown_preferences_rejected_and_legacy_defaults_preserved():
    assert api.WorkInput(title="Legacy").market == "china"
    assert api.WorkInput(title="Legacy").output_locale == "zh-CN"
    for field in ["market", "output_locale"]:
        with pytest.raises(ValidationError):
            api.WorkInput.model_validate({"title": "Original", field: "unsupported"})


@pytest.mark.parametrize("text", ["داخلي - مكتبة - نهار\nتضع مريم المفتاح.", "シーン1：図書室\n澪が鍵を置く。"])
def test_native_screenplay_headings_are_accepted_for_drama_and_rejected_for_novels(text):
    from agent.studio_writing import validate_chapter_format
    validate_chapter_format("short_drama", text)
    with pytest.raises(ValueError):
        validate_chapter_format("novel", text)


def test_arabic_speaker_lists_are_not_accepted_as_novel_prose():
    from agent.studio_writing import validate_chapter_format
    with pytest.raises(ValueError):
        validate_chapter_format("novel", "مريم: أين المفتاح؟\nحسن: فوق الطاولة.\nسلمى: وجدته.")


@pytest.mark.parametrize("locale", ["en", "ja-JP", "ar"])
def test_export_headings_and_generated_default_titles_follow_output_language(locale):
    from agent.studio_store import export_work_text
    from agent.studio_region import unit_title
    work = api.WorkInput(title="Original", content_type="novel", output_locale=locale, chapters=[{"number": 1, "title": "Original unit", "content": "Unchanged prose."}], characters="【人物：Mara】\n定位：\n  Repairer\n【人物结束】").model_dump()
    text = export_work_text(work)
    assert "Unchanged prose." in text and "Original unit" in text
    assert "定位：" not in text and "【人物结束】" not in text
    assert unit_title(work, 1) in text


@pytest.mark.parametrize("locale", ["zh-CN", "en", "ja-JP", "ar"])
def test_duplicate_preserves_output_preferences_and_bounds_native_title(regional_store, locale):
    work = regional_store.create_work(api.WorkInput(title="A" * 80, content_type="novel", output_locale=locale, market="global").model_dump())
    copy = api.duplicate_work(work["id"])
    assert len(copy["title"]) <= 80
    assert copy["output_locale"] == locale and copy["market"] == "global"
    assert copy["id"] != work["id"]
    assert regional_store.get("works", work["id"])["title"] == "A" * 80
