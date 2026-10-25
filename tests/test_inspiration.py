"""Offline inspiration flow: temporary database and mocked paid calls only."""
import asyncio
import copy
import json
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import studio_main
from agent import studio_api as api
from agent.studio_inspiration import InspirationStore, InspirationInput, InspirationAction, PlanEdit, execute, messages_for
from agent.studio_jobs import JobStore, JobInput
from agent.studio_store import StudioStore


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = StudioStore(tmp_path / "studio.sqlite3")
    monkeypatch.setattr(api, "store", store)
    monkeypatch.setattr(api.llm, "_refresh_config", lambda: None)
    monkeypatch.setattr(api.llm, "API_KEY", "offline-only")
    return store, InspirationStore(store), TestClient(studio_main.app)


def body(kind="novel", **changes):
    return InspirationInput.model_validate({"market": "china", "output_locale": "zh-CN", "content_type": kind,
        "prompt": "一个能收到未来来信的修表师，想找回失踪的妹妹", "request_key": str(uuid.uuid4()), **changes})


def plans():
    return [{"title": f"未来来信{n}", "summary": f"修表师在第{n}条时间线上寻找妹妹。",
             "story": f"第{n}个故事中，修表师收到未来来信，得知妹妹失踪的秘密。他必须牺牲自己的记忆才能改变命运，并最终与妹妹重逢。"} for n in range(1, 4)]


def analysis():
    return {"title": "未来来信", "genre": "悬疑", "premise": "修表师收到未来的来信，为寻找失踪的妹妹，逐渐发现城市的时钟与人的记忆相连。他每改变一段未来，便失去一段往事，最后在遗忘与亲情间作出选择。",
        "audience": "general", "units": 12, "words_per_chapter": 1500,
        "creative": {"genres": ["悬疑", "科幻"], "core": ["未来来信"], "styles": ["温暖"], "highlights": "用记忆换取改变未来的机会"},
        "world_snapshot": {"name": "钟城", "description": "记忆与机械相连的现代城市", "sections": {"world_rules": "改变未来会失去记忆", "locations": "旧钟楼与修表铺"}}}


def run(service, result):
    job = service.claim()
    assert job
    calls = []

    async def generate(messages, **kwargs):
        calls.append((messages, kwargs))
        return json.dumps(result, ensure_ascii=False) if not isinstance(result, str) else result

    asyncio.run(execute(service, job, generate))
    return service.view(job["session_id"]), calls


def action(service, session, operation, index=0, **changes):
    return service.action(session["id"], InspirationAction(action=operation, revision=session["revision"],
        plan_id=session["plans"][index]["id"], request_key=str(uuid.uuid4()), **changes))


@pytest.mark.parametrize("kind", ["short_drama", "novel"])
def test_three_plans_revise_select_analyze_confirm_and_create(setup, kind):
    store, service, client = setup
    response = client.post("/api/studio/inspirations", json=body(kind).model_dump())
    assert response.status_code == 202
    session, calls = run(service, {"plans": plans()})
    assert len(session["plans"]) == 3 and store.list("works") == []
    assert calls[0][1]["retries"] == 1 and calls[0][1]["reject_truncated"] is True
    assert ("小说策划" if kind == "novel" else "短剧策划") in calls[0][0][0]["content"]
    originals = copy.deepcopy(session["plans"])
    revise_response = client.post(f"/api/studio/inspirations/{session['id']}/actions", json={"action": "revise", "revision": session["revision"],
        "plan_id": session["plans"][1]["id"], "feedback": "主角改成女性", "request_key": str(uuid.uuid4())})
    assert revise_response.status_code == 202
    changed = {**plans()[1], "title": "女修表师", "story": "女修表师收到了妹妹从未来寄来的信，她在层层谜团中寻找真相，最终带着妹妹走出了记忆迷宫。"}
    session, _ = run(service, changed)
    assert session["plans"][0] == originals[0] and session["plans"][2] == originals[2]
    assert session["plans"][1]["title"] == "女修表师"
    analyze_response = client.post(f"/api/studio/inspirations/{session['id']}/actions", json={"action": "analyze", "revision": session["revision"],
        "plan_id": session["plans"][1]["id"], "request_key": str(uuid.uuid4())})
    assert analyze_response.status_code == 202
    session, _ = run(service, analysis())
    assert session["analysis"]["content_type"] == kind
    assert session["analysis"]["world_id"] is None
    assert session["analyzed_plan_id"] == session["plans"][1]["id"]
    assert store.list("works") == [] and store.list("worlds") == []
    created = client.post("/api/studio/works", json=session["analysis"])
    assert created.status_code == 200
    assert created.json()["world_snapshot"]["sections"]["world_rules"] == "改变未来会失去记忆"
    assert created.json()["chapters"] == []
    reloaded = client.get(f"/api/studio/inspirations/{session['id']}")
    assert reloaded.status_code == 200 and reloaded.json()["analysis"] == session["analysis"]


def test_manual_edit_invalidates_analysis_and_requires_current_revision(setup):
    _, service, client = setup
    ident = service.create(body())
    session, _ = run(service, {"plans": plans()})
    action(service, session, "analyze")
    session, _ = run(service, analysis())
    plan = session["plans"][0]
    url = f"/api/studio/inspirations/{ident}/plans/{plan['id']}"
    payload = {k: v for k, v in plan.items() if k != "id"} | {"title": "手动修改", "revision": session["revision"]}
    result = client.put(url, json=payload)
    assert result.status_code == 200
    assert result.json()["analysis"] is None and result.json()["analyzed_plan_id"] is None
    assert result.json()["plans"][0]["title"] == "手动修改"
    assert client.put(url, json=payload).status_code == 409


def test_idempotency_before_and_after_completion_and_conflicting_keys(setup):
    _, service, _ = setup
    payload = body()
    ident = service.create(payload)
    assert service.create(payload) == ident
    run(service, {"plans": plans()})
    assert service.create(payload) == ident
    with pytest.raises(HTTPException) as error:
        service.create(body(request_key=payload.request_key, prompt="完全不同的想法"))
    assert error.value.status_code == 409
    assert len(service.jobs()) == 1


@pytest.mark.parametrize("result", ["", "not json", '{"plans":[]}', {"plans": plans()[:2]}, {"plans": [plans()[0]] * 3}])
def test_malformed_generation_never_produces_fake_plans(setup, result):
    store, service, _ = setup
    ident = service.create(body())
    session, calls = run(service, result)
    assert session["job"]["status"] == "failed" and session["plans"] == []
    assert len(calls) == 1 and store.list("works") == []
    service.resume(session["job"]["id"])
    recovered, _ = run(service, {"plans": plans()})
    assert recovered["id"] == ident and len(recovered["plans"]) == 3


def test_analysis_validation_preserves_three_plans_on_failure(setup):
    _, service, _ = setup
    service.create(body())
    session, _ = run(service, {"plans": plans()})
    previous = session["plans"]
    action(service, session, "analyze")
    invalid = analysis()
    invalid["creative"]["core"] = []
    failed, _ = run(service, invalid)
    assert failed["job"]["status"] == "failed"
    assert failed["plans"] == previous and failed["analysis"] is None


def test_recovery_is_worker_owned_and_session_survives_restart(setup):
    store, service, _ = setup
    ident = service.create(body())
    claimed = service.claim()
    assert claimed
    restarted = InspirationStore(StudioStore(store.path))
    assert restarted.view(ident)["job"]["status"] == "running"
    restarted.recover()
    assert restarted.view(ident)["job"]["status"] == "interrupted"
    restarted.resume(claimed["id"])
    session, _ = run(restarted, {"plans": plans()})
    assert session["job"]["status"] == "completed"


def test_shared_queue_capacity_and_mutual_exclusion(setup):
    store, service, _ = setup
    work = store.create_work(api.WorkInput(title="排队作品").model_dump())
    jobs = JobStore(store)
    work_job = jobs.create(work["id"], JobInput(revision=1, request_key=str(uuid.uuid4())))
    ident = service.create(body())
    claimed = service.claim()
    assert claimed and jobs.claim() is None
    service.finish(claimed["id"], error="test interruption")
    assert jobs.claim()["id"] == work_job["id"]
    assert service.claim() is None
    for _ in range(10):
        service.create(body())
    with pytest.raises(HTTPException) as error:
        service.create(body())
    assert error.value.status_code == 429
    assert service.view(ident)["job"]["status"] == "failed"


def test_no_edit_or_second_action_while_queued_and_no_stale_retry(setup):
    _, service, _ = setup
    ident = service.create(body())
    session, _ = run(service, {"plans": plans()})
    action(service, session, "revise", feedback="更多悬疑")
    with pytest.raises(HTTPException):
        action(service, session, "analyze")
    failed, _ = run(service, "invalid")
    old_job = failed["job"]["id"]
    plan = failed["plans"][0]
    service.edit(ident, plan["id"], PlanEdit(**{k: v for k, v in plan.items() if k != "id"}, revision=failed["revision"]))
    with pytest.raises(HTTPException) as error:
        service.resume(old_job)
    assert error.value.status_code == 409


def test_market_input_and_model_guards_and_legacy_entry(setup, monkeypatch):
    _, service, client = setup
    invalid = body().model_dump() | {"market": "japan"}
    assert client.post("/api/studio/inspirations", json=invalid).status_code == 422
    assert client.post("/api/studio/inspirations", json=body().model_dump() | {"prompt": "   "}).status_code == 422
    legacy = TestClient(main.app)
    assert legacy.post("/api/studio/inspirations", json=body().model_dump(), headers={"Host": "juben.onesay.top", "X-Duanju-Site": "china"}).status_code == 403
    assert legacy.post("/api/studio/inspirations", json=body().model_dump(), headers={"X-Duanju-Site": "china"}).status_code == 202
    monkeypatch.setattr(api.llm, "API_KEY", "")
    assert client.post("/api/studio/inspirations", json=body().model_dump()).status_code == 503


def test_analysis_prompt_only_uses_chosen_plan(setup):
    _, service, _ = setup
    service.create(body())
    session, _ = run(service, {"plans": plans()})
    action(service, session, "analyze", index=2)
    messages = messages_for(service.claim())
    context = json.loads(messages[-1]["content"].split("\n任务：")[0])
    assert context["用户选定方案"] == session["plans"][2]
    assert "plans" not in context


def test_worker_dispatches_both_queues_in_creation_order(setup, monkeypatch):
    from agent import studio_worker as worker
    store, service, _ = setup
    jobs = JobStore(store)
    ident = service.create(body())
    # Give creation times an explicit order rather than relying on clock granularity.
    with service.transaction() as db:
        session = service.read(db, "inspiration_sessions", ident)
        first = service.read(db, "inspiration_jobs", session["job_id"])
        first["created_at"] = 1
        service.write_job(db, first)
    work = store.create_work(api.WorkInput(title="下一任务").model_dump())
    jobs.create(work["id"], JobInput(revision=1, request_key=str(uuid.uuid4())))
    order = []

    async def inspiration_call(storage, job):
        order.append("inspiration")
        storage.finish(job["id"], result=plans())

    async def work_call(storage, job):
        order.append("work")
        storage.finish_step(job["id"], {"action": "premise", "number": 1, "text": "测试故事设定"})

    monkeypatch.setattr(worker, "execute_inspiration", inspiration_call)
    monkeypatch.setattr(worker, "execute", work_call)
    assert asyncio.run(worker.run_once(jobs, service))
    assert asyncio.run(worker.run_once(jobs, service))
    assert not asyncio.run(worker.run_once(jobs, service))
    assert order == ["inspiration", "work"]


def test_work_queue_also_counts_inspiration_jobs_when_full(setup):
    store, service, _ = setup
    for _ in range(10):
        service.create(body())
    work = store.create_work(api.WorkInput(title="队列已满").model_dump())
    with pytest.raises(HTTPException) as error:
        JobStore(store).create(work["id"], JobInput(revision=1, request_key=str(uuid.uuid4())))
    assert error.value.status_code == 429
