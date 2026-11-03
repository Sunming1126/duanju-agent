"""Taiwan policy, curated references and both generation paths; no paid requests."""
import asyncio
import json
import uuid

import pytest
from fastapi import HTTPException

import studio_main
from agent import studio_api as api
from agent.knowledge import KnowledgeBase
from agent.market import normalize_market, normalize_locale
from agent.studio_inspiration import InspirationInput, messages_for as inspiration_messages
from agent.studio_jobs import JobInput, JobStore, execute, messages_for
from agent.studio_store import StudioStore
from agent.studio_writing import system_prompt
from studio_test_scope import browser_scope


@pytest.fixture
def kb(monkeypatch):
    knowledge = KnowledgeBase()
    monkeypatch.setattr(api, "get_kb", lambda: knowledge)
    return knowledge


def test_taiwan_identity_and_curated_source_integrity(kb):
    for alias in ("taiwan", "TW", "台灣", "臺灣", "台湾"):
        assert normalize_market(alias) == "taiwan"
    assert normalize_locale(None, "taiwan") == "zh-TW"
    assert api.WorkInput(title="臺灣新作", market="taiwan").output_locale == "zh-TW"
    assert api.WorkInput(title="English edition", market="taiwan", output_locale="en").output_locale == "en"
    rows = [row for row in kb.items if row["market"] == "taiwan"]
    assert len(rows) == 12 and len({row["id"] for row in rows}) == 12
    assert sum(row["content_type"] == "novel" for row in rows) == 6
    for row in rows:
        assert row["source_url"].startswith("https://")
        assert row["source_type"] == "curated" and row["collected_at"] == "2026-11-03"
        assert row["lessons"] and row["locale"] == "zh-TW"
        assert not row.get("script") and not row.get("chapters")
        if row["content_type"] == "short_drama":
            assert row["source_form"] == "tv_series"
            assert "非短劇成稿" in row["lessons"][0]


@pytest.mark.parametrize("kind", ["novel", "short_drama"])
@pytest.mark.parametrize("locale", ["zh-CN", "zh-TW", "en", "ja-JP", "ar"])
def test_reference_list_detail_search_and_context_are_market_bound(kb, kind, locale):
    rows = api.references("", kind, 30, "taiwan", locale)["items"]
    assert len(rows) == 6
    reference = api.get_reference(rows[0]["id"], "taiwan", locale)
    assert reference["market"] == "taiwan" and reference["source_url"]
    with pytest.raises(HTTPException) as error:
        api.get_reference(rows[0]["id"], "china", "zh-TW")
    assert error.value.status_code == 404
    work = api.WorkInput(title="Test", content_type=kind, market="taiwan", output_locale=locale,
                         genre=reference["genre"], premise=reference["logline"], reference_ids=[reference["id"]]).model_dump()
    context = api.reference_context(work)
    assert context and all(row["market"] == "taiwan" and row["content_type"] == kind for row in context)
    work["reference_ids"] = ["tw-ref-port-series" if kind == "novel" else "tw-ref-port-novel"]
    with pytest.raises(ValueError):
        api.reference_context(work)


def test_reference_search_uses_localized_titles_and_genres(kb):
    for query, expected in [("Ghost Town", "tw-ref-ghost-town"), ("法廷", "tw-ref-port-novel"), ("عائلي", "tw-ref-ghost-town")]:
        results = kb.search(query, market="taiwan", content_type="novel", top_k=12)
        assert expected in {row["id"] for row in results}


@pytest.mark.parametrize("kind", ["novel", "short_drama"])
def test_every_inspiration_and_writing_action_uses_independent_taiwan_policy(kind):
    work = api.WorkInput(title="Test", content_type=kind, market="taiwan", output_locale="zh-TW", units=1).model_dump()
    prompt = system_prompt(work)
    assert "Taiwan creative profile v1" in prompt
    assert ("Taiwan novel craft" if kind == "novel" else "Taiwan short-drama craft") in prompt
    assert "historical, wuxia, xianxia" in prompt
    assert "Taiwan creative profile v1" not in system_prompt({**work, "market": "china"})
    job = {"draft": work, "snapshot": {"world_snapshot": None}, "continuity": [], "input": {}}
    for action in ("premise", "characters", "outline", "chapter", "world"):
        messages = messages_for(job, {"action": action, "number": 1}, [])
        assert "Taiwan creative profile v1" in messages[0]["content"]
        assert "Traditional Chinese" in messages[0]["content"]
    source = InspirationInput(market="taiwan", output_locale="zh-TW", content_type=kind, prompt="原創故事", request_key=str(uuid.uuid4())).model_dump()
    session = {"input": source, "plans": [{"id":"one", "title":"Title", "summary":"Summary", "story":"Story"}]}
    for action in ("generate", "revise", "analyze"):
        messages = inspiration_messages({"snapshot": session, "action": action, "input":{"plan_id":"one", "feedback":"More specific"}})
        assert "Taiwan creative profile v1" in messages[0]["content"]
        assert ("Taiwan novel craft" if kind == "novel" else "Taiwan short-drama craft") in messages[0]["content"]


@pytest.mark.parametrize("kind", ["novel", "short_drama"])
def test_taiwan_queue_uses_frozen_style_and_does_not_rewrite_work(tmp_path, monkeypatch, kb, kind):
    store = StudioStore(tmp_path / "taiwan.sqlite3")
    monkeypatch.setattr(api, "store", store)
    with browser_scope(studio_main.app):
        data = api.WorkInput(title="臺南的晚餐", content_type=kind, market="taiwan", output_locale="zh-TW", units=1, premise="兩人約定見面").model_dump()
        work = api.create_work(api.WorkInput(**data))
        jobs = JobStore(store)
        job = jobs.create(work["id"], JobInput(action="chapter", revision=work["revision"], request_key=str(uuid.uuid4())))
        store.update_work(work["id"], {**data, "market":"china", "output_locale":"zh-CN"}, work["revision"])
        claimed = jobs.claim()
        assert claimed["snapshot"]["market"] == "taiwan"
        manuscript = "她把兩張車票放到桌上，先問他星期日是否有空。\n「我想去，但要先交班。」他說。她沒有替他回答，打開日曆等他確認。" if kind == "novel" else "INT. 臺南小店 - 夜\n她將兩張車票放到桌上。\n她：星期日有空嗎？\n他拿出班表，先確認交班時間。"
        calls = []
        async def generate(messages, **options):
            calls.append(messages)
            return json.dumps({"text":manuscript,"summary":"兩人核對見面時間。"}, ensure_ascii=False)
        asyncio.run(execute(jobs, claimed, generate))
        final = jobs.get(job["id"])
        assert final["status"] == "completed" and len(calls) == 1
        assert "Taiwan creative profile v1" in calls[0][0]["content"]
        assert store.get("works",work["id"])["chapters"] == []
        assert store.get("works",work["id"])["market"] == "china"


@pytest.mark.parametrize("kind", ["novel", "short_drama"])
@pytest.mark.parametrize("locale", ["zh-TW", "en"])
def test_http_reference_to_authenticated_work_and_frozen_job(tmp_path, monkeypatch, kb, kind, locale):
    store = StudioStore(tmp_path / "taiwan-http.sqlite3")
    monkeypatch.setattr(api, "store", store)
    monkeypatch.setattr(api.llm, "_refresh_config", lambda: None)
    monkeypatch.setattr(api.llm, "API_KEY", "offline-test-only")
    with browser_scope(studio_main.app) as client:
        params = {"market":"taiwan", "output_locale":locale, "content_type":kind}
        listing = client.get("/api/studio/references", params=params)
        assert listing.status_code == 200
        rows = listing.json()["items"]
        assert len(rows) == 6
        row = rows[0]
        detail = client.get("/api/studio/references/"+row["id"], params={"market":"taiwan", "output_locale":locale})
        assert detail.status_code == 200 and detail.json()["source_url"] == row["source_url"]
        assert client.get("/api/studio/references/"+row["id"], params={"market":"china", "output_locale":"zh-TW"}).status_code == 404
        payload = {"title":"Taiwan HTTP check", "content_type":kind, "market":"taiwan", "output_locale":locale,
                   "genre":row["genre"], "premise":"Characters make a consequential choice.", "units":1, "reference_ids":[row["id"]]}
        wrong_kind = "tw-ref-port-series" if kind == "novel" else "tw-ref-port-novel"
        assert client.post("/api/studio/works", json={**payload,"reference_ids":[wrong_kind]}).status_code == 422
        assert client.post("/api/studio/works", json={**payload,"market":"china"}).status_code == 404
        assert client.get("/api/studio/works").json()["items"] == []
        created = client.post("/api/studio/works", json=payload)
        assert created.status_code == 200
        work = created.json()
        assert work["market"] == "taiwan" and work["output_locale"] == locale
        queued = client.post(f"/api/studio/works/{work['id']}/jobs", json={"action":"chapter", "revision":work["revision"], "request_key":str(uuid.uuid4())})
        assert queued.status_code == 202
        job = JobStore(store).get(queued.json()["id"])
        refs = api.reference_context(job["snapshot"])
        assert refs and all(ref["market"] == "taiwan" and ref["content_type"] == kind for ref in refs)
        prompts = messages_for(job,{"action":"chapter","number":1},refs)
        assert "Taiwan creative profile v1" in prompts[0]["content"]
        assert ("Traditional Chinese" if locale == "zh-TW" else "English") in prompts[0]["content"]
        assert row["source_url"] in prompts[1]["content"]
        assert client.get(f"/api/studio/works/{work['id']}").json()["chapters"] == []
