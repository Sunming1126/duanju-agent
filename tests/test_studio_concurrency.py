"""Concurrency, fairness, continuation and provider backoff without paid calls."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import uuid

import pytest

from agent import studio_api as api
from agent.studio_identity import actor
from agent.studio_inspiration import InspirationInput, InspirationStore
from agent.studio_jobs import JobInput, JobStore, execute
from agent.studio_queue import MAX_CONCURRENT, next_job
from agent.studio_store import StudioStore
from agent.studio_worker import claim_next, serve
from test_plotloom_mvp import fake


@pytest.fixture
def queue(tmp_path, monkeypatch):
    store = StudioStore(tmp_path / "concurrent.sqlite3")
    monkeypatch.setattr(api, "store", store)
    monkeypatch.setattr(api, "reference_context", lambda value: [])
    return store, JobStore(store), InspirationStore(store)


def create(queue, owner="one-user", **changes):
    store, jobs, _ = queue
    identity = actor.set(owner)
    try:
        work = store.create_work(api.WorkInput(title="离线并发作品", content_type="novel", units=3, premise="寻找失踪的信件").model_dump())
        return jobs.create(work["id"], JobInput(revision=1, request_key=str(uuid.uuid4()), **changes))
    finally:
        actor.reset(identity)


def inspiration(queue, owner="one-user"):
    service = queue[2]
    identity = actor.set(owner)
    try:
        ident = service.create(InspirationInput(market="china", output_locale="zh-CN", content_type="novel", prompt="修表铺的秘密", request_key=str(uuid.uuid4())))
        return service.view(ident)["job"]
    finally:
        actor.reset(identity)


def test_atomic_claim_never_exceeds_three_even_when_claims_race(queue):
    _, jobs, _ = queue
    for _ in range(8):
        create(queue)
    with ThreadPoolExecutor(max_workers=8) as threads:
        results = list(threads.map(lambda _: jobs.claim(), range(8)))
    assert sum(result is not None for result in results) == MAX_CONCURRENT == 3
    assert len({result["id"] for result in results if result}) == 3
    assert jobs.claim() is None


def test_both_task_types_share_same_budget_and_one_user_can_use_all_slots(queue):
    _, jobs, service = queue
    first = create(queue)
    second = create(queue)
    third = inspiration(queue)
    fourth = inspiration(queue)
    assert jobs.claim(first["id"])
    assert service.claim(third["id"])
    assert jobs.claim(second["id"])
    assert service.claim(fourth["id"]) is None
    jobs.finish_step(first["id"], error="test release")
    assert service.claim(fourth["id"])


def test_worker_really_overlaps_three_calls_and_does_not_start_fourth(queue, monkeypatch):
    _, jobs, service = queue
    for _ in range(6):
        create(queue)

    async def check():
        active = 0
        peak = 0
        count = 0
        started = asyncio.Event()
        release = asyncio.Event()
        finished = asyncio.Event()

        async def generate(*args, **kwargs):
            nonlocal active, peak, count
            active += 1
            count += 1
            peak = max(peak, active)
            if active == 3:
                started.set()
            await release.wait()
            active -= 1
            if count == 6 and active == 0:
                finished.set()
            return "她想找回遗失的信件，但必须先面对自己曾经隐瞒的事实。" * 3

        monkeypatch.setattr(api.llm, "chat", generate)
        worker = asyncio.create_task(serve(jobs, service))
        try:
            await asyncio.wait_for(started.wait(), 3)
            assert active == peak == count == 3
            assert sum(job["status"] == "queued" for job in jobs.list()) == 3
            release.set()
            await asyncio.wait_for(finished.wait(), 3)
            await asyncio.sleep(0)
            assert peak == 3 and count == 6
        finally:
            worker.cancel()
            with pytest.raises(asyncio.CancelledError):
                await worker
        assert all(job["status"] == "completed" for job in jobs.list())

    asyncio.run(check())


def test_long_work_yields_after_one_step_and_new_owner_gets_next_turn(queue):
    _, jobs, service = queue
    original = create(queue, owner="a", mode="all")
    claimed = claim_next(jobs, service)
    assert claimed[1]["id"] == original["id"]
    updated = asyncio.run(execute(jobs, claimed[1], fake, max_steps=1))
    assert updated["status"] == "queued" and len(updated["results"]) == 1
    newcomer = create(queue, owner="b")
    assert claim_next(jobs, service)[1]["id"] == newcomer["id"]
    assert jobs.get(original["id"])["draft"]["premise"]


def test_fair_selection_prefers_owner_with_fewer_running_requests():
    rows = [
        {"id":"a1", "owner_id":"a", "status":"running", "created_at":1},
        {"id":"a2", "owner_id":"a", "status":"running", "created_at":2},
        {"id":"a3", "owner_id":"a", "status":"queued", "created_at":3},
        {"id":"b1", "owner_id":"b", "status":"queued", "created_at":4},
    ]
    assert next_job(rows)["id"] == "b1"


def test_step_scheduling_keeps_chapter_order_and_completed_steps_on_resume(queue):
    store, jobs, _ = queue
    original = create(queue, mode="all")
    actions = []
    while True:
        claimed = jobs.claim(original["id"])
        assert claimed
        assert jobs.claim(original["id"]) is None
        current = claimed["steps"][len(claimed["results"])]
        actions.append((current["action"], current["number"]))
        updated = asyncio.run(execute(jobs, claimed, fake, max_steps=1))
        if len(updated["results"]) == 2:
            jobs.control(updated["id"], "stop")
            assert jobs.get(updated["id"])["status"] == "stopped"
            jobs.control(updated["id"], "resume")
        if updated["status"] == "completed":
            break
    assert actions == [("premise",1), ("characters",1), ("outline",1), ("chapter",1), ("chapter",2), ("chapter",3)]
    assert [chapter["number"] for chapter in updated["draft"]["chapters"]] == [1,2,3]
    assert len(updated["continuity"]) == 3
    assert store.get("works", original["work_id"])["chapters"] == []


def test_rate_limit_pauses_new_dispatch_without_retrying_paid_request(queue, monkeypatch):
    from agent import studio_queue
    _, jobs, _ = queue
    first = create(queue)
    second = create(queue)
    calls = []

    async def limited(*args, **kwargs):
        calls.append(1)
        kwargs["err_box"]["kind"] = "rate_limit"
        return None

    result = asyncio.run(execute(jobs, jobs.claim(first["id"]), limited, max_steps=1))
    assert result["status"] == "failed" and calls == [1]
    assert jobs.claim(second["id"]) is None
    monkeypatch.setattr(studio_queue, "now", lambda: 9999999999999)
    assert jobs.claim(second["id"])


def test_configured_parallelism_applies_atomically_to_both_queues(queue,monkeypatch):
    from agent.studio_queue import policy
    monkeypatch.setenv('PLOTLOOM_MAX_CONCURRENT','5')
    _,jobs,service=queue
    work_ids=[create(queue)['id'] for _ in range(4)]
    inspiration_ids=[inspiration(queue)['id'] for _ in range(3)]
    operations=[lambda ident=ident:jobs.claim(ident) for ident in work_ids]+[lambda ident=ident:service.claim(ident) for ident in inspiration_ids]
    with ThreadPoolExecutor(max_workers=7) as pool:
        claimed=list(pool.map(lambda operation:operation(),operations))
    assert sum(item is not None for item in claimed)==policy().concurrent==5
    assert jobs.claim() is None and service.claim() is None


def test_owner_queue_cap_counts_both_task_types_and_leaves_room_for_others(queue,monkeypatch):
    from fastapi import HTTPException
    from agent.studio_queue import policy
    monkeypatch.setenv('PLOTLOOM_MAX_QUEUED','12')
    monkeypatch.setenv('PLOTLOOM_MAX_QUEUED_PER_OWNER','2')
    create(queue,owner='a');inspiration(queue,owner='a')
    with pytest.raises(HTTPException) as error:create(queue,owner='a')
    assert error.value.status_code==429 and '当前空间' in error.value.detail
    assert create(queue,owner='b')
    assert policy().queued==12


def test_dispatch_rpm_is_shared_atomic_and_survives_a_new_store(queue,monkeypatch):
    from agent import studio_queue
    _,jobs,service=queue
    monkeypatch.setenv('PLOTLOOM_MAX_CONCURRENT','8')
    monkeypatch.setenv('PLOTLOOM_REQUESTS_PER_MINUTE','2')
    moment=[100000]
    monkeypatch.setattr(studio_queue,'now',lambda:moment[0])
    first=create(queue);second=inspiration(queue);third=create(queue)
    with ThreadPoolExecutor(max_workers=3) as threads:
        results=list(threads.map(lambda fn:fn(),[lambda:jobs.claim(first['id']),lambda:service.claim(second['id']),lambda:jobs.claim(third['id'])]))
    assert sum(item is not None for item in results)==2
    with queue[0].transaction() as db:
        assert studio_queue.queue_status(db)['dispatch_retry_after_seconds']==60
    assert JobStore(queue[0]).claim() is None
    # Time expiry permits the remaining queued task, without replaying either claim.
    moment[0]+=60001
    remaining=jobs.claim() or service.claim()
    assert remaining is not None
    assert len({item['id'] for item in results if item}|{remaining['id']})==3


def test_throttle_cooldown_preserves_upstream_delay_and_grows_without_retry(queue,monkeypatch):
    from agent import studio_queue as q
    moment=[100000];monkeypatch.setattr(q,'now',lambda:moment[0])
    q.pause_after_rate_limit(queue[0],{'retry_after_seconds':90})
    with queue[0].transaction() as db:assert q.queue_status(db)['dispatch_retry_after_seconds']==90
    q.pause_after_rate_limit(queue[0])
    with queue[0].transaction() as db:assert q.queue_status(db)['dispatch_retry_after_seconds']==90
    q.pause_after_rate_limit(queue[0])
    with queue[0].transaction() as db:assert q.queue_status(db)['dispatch_retry_after_seconds']==120
    q.pause_after_rate_limit(queue[0],{'limit_type':'quota'})
    with queue[0].transaction() as db:assert q.queue_status(db)['dispatch_retry_after_seconds']==3600
    assert queue[1].claim() is None


@pytest.mark.parametrize('name,value',[('PLOTLOOM_MAX_CONCURRENT','51'),('PLOTLOOM_MAX_CONCURRENT','bad'),('PLOTLOOM_MAX_QUEUED','0'),('PLOTLOOM_REQUESTS_PER_MINUTE','-1')])
def test_invalid_policy_fails_before_any_provider_request(monkeypatch,name,value):
    from agent.studio_queue import policy
    monkeypatch.setenv(name,value)
    with pytest.raises(ValueError):policy()


def test_status_reflects_same_policy_as_worker_and_claim_guard(queue,monkeypatch):
    from fastapi.testclient import TestClient
    import studio_main
    monkeypatch.setenv('PLOTLOOM_MAX_CONCURRENT','5')
    monkeypatch.setenv('PLOTLOOM_MAX_QUEUED','20')
    monkeypatch.setenv('PLOTLOOM_MAX_QUEUED_PER_OWNER','4')
    response=TestClient(studio_main.app).get('/api/studio/status')
    assert response.status_code==200
    value=response.json()
    assert value['max_concurrent_requests']==5 and value['max_queued_requests']==20 and value['max_queued_per_space']==4
    assert value['dispatch_retry_after_seconds']==0


def test_worker_uses_configured_five_slots_and_keeps_sixth_waiting(queue,monkeypatch):
    monkeypatch.setenv('PLOTLOOM_MAX_CONCURRENT','5')
    for _ in range(6):create(queue)
    async def check():
        active=0;peak=0;reached=asyncio.Event();release=asyncio.Event()
        async def generate(*args,**kwargs):
            nonlocal active,peak
            active+=1;peak=max(peak,active)
            if active==5:reached.set()
            try:await release.wait()
            finally:active-=1
            return '她在旧钟表中发现了那封信，但信上的日期让她重新审视父亲留下的话。'*3
        monkeypatch.setattr(api.llm,'chat',generate)
        worker=asyncio.create_task(serve(queue[1],queue[2]))
        try:
            await asyncio.wait_for(reached.wait(),3)
            assert active==peak==5
            assert sum(j['status']=='queued' for j in queue[1].list())==1
        finally:
            worker.cancel()
            with pytest.raises(asyncio.CancelledError):await worker
    asyncio.run(check())
