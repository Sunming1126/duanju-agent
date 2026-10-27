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
