"""Library API regressions with temporary SQLite files and no model calls."""
import uuid

import pytest
from fastapi.testclient import TestClient

import studio_main
import main
from agent import studio_api as api
from agent.studio_jobs import JobInput, JobStore
from agent.studio_store import StudioStore


@pytest.fixture
def library(tmp_path, monkeypatch):
    store = StudioStore(tmp_path / "library.sqlite3")
    monkeypatch.setattr(api, "store", store)
    return store, TestClient(studio_main.app, headers={"X-Duanju-Site": "china"})


def create(store, **changes):
    return store.create_work(api.WorkInput.model_validate({"title": "雾城来信", **changes}).model_dump())


def test_summary_is_small_and_keeps_archived_works_and_full_api(library):
    store, client = library
    work = create(store, content_type="novel", archived=True, units=2,
                  premise="故事" * 10000, chapters=[{"number": 1, "content": "正文" * 50000}, {"number": 2, "content": "  "}])
    response = client.get("/api/studio/works?view=summary")
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["id"] == work["id"] and item["archived"] is True
    assert item["completed_units"] == 1 and item["units"] == 2
    assert not {"chapters", "premise", "world_snapshot", "creative"} & item.keys()
    full = client.get("/api/studio/works")
    assert full.json()["items"][0]["chapters"] == work["chapters"]
    assert len(response.content) < len(full.content) / 100
    assert client.get("/api/studio/works?view=unknown").status_code == 422


def test_archive_changes_only_flag_and_rejects_stale_revisions(library):
    store, client = library
    original = create(store, chapters=[{"number": 1, "content": "保留正文"}], world_snapshot={"name": "城", "sections": {"world_rules": "不可逆转时间"}})
    path = f"/api/studio/works/{original['id']}/archive"
    archived = client.patch(path, json={"revision": 1, "archived": True})
    assert archived.status_code == 200 and archived.json()["archived"] is True
    assert client.patch(path, json={"revision": 1, "archived": False}).status_code == 409
    saved = store.get("works", original["id"])
    assert {k: v for k, v in saved.items() if k not in {"archived", "revision", "updated_at"}} == {k: v for k, v in original.items() if k not in {"archived", "revision", "updated_at"}}
    assert client.patch(path, json={"revision": 2, "archived": False}).json()["archived"] is False


@pytest.mark.parametrize("status", ["queued", "running", "stopping"])
def test_delete_refuses_active_jobs_without_touching_any_data(library, status):
    store, client = library
    work = create(store)
    jobs = JobStore(store)
    job = jobs.create(work["id"], JobInput(revision=1, request_key=str(uuid.uuid4())))
    with jobs.transaction() as db:
        job["status"] = status
        jobs.write(db, job)
    response = client.delete(f"/api/studio/works/{work['id']}?revision=1")
    assert response.status_code == 409
    assert store.get("works", work["id"]) == work
    assert jobs.get(job["id"])["status"] == status


def test_delete_cleans_dependents_and_keeps_other_works_and_worlds(library):
    store, client = library
    world = store.create_world({"name": "世界原件", "description": "", "sections": {}})
    work = create(store, world_id=world["id"])
    other = create(store, title="另一个故事", world_id=world["id"])
    candidate = store.begin_candidate(work["id"], "premise", 1, 1)
    path = f"/api/studio/works/{work['id']}"
    assert client.delete(path + "?revision=1").status_code == 409
    store.complete_candidate(candidate["id"], text="候选内容")
    jobs = JobStore(store)
    job = jobs.create(work["id"], JobInput(revision=1, request_key=str(uuid.uuid4())))
    jobs.control(job["id"], "stop")
    backup = client.get(path + "/backup").json()
    assert client.delete(path).status_code == 422
    assert client.delete(path + "?revision=2").status_code == 409
    assert client.delete(path + "?revision=1").status_code == 200
    assert client.get(path).status_code == 404
    assert client.delete(path + "?revision=1").status_code == 404
    assert jobs.list(work["id"]) == [] and store.list("candidates", work["id"]) == []
    assert store.get("works", other["id"]) == other
    assert store.get("worlds", world["id"]) == world
    restored = client.post("/api/studio/works/import", json=backup)
    assert restored.status_code == 200
    assert restored.json()["id"] != work["id"]
    assert {key: restored.json()["world_snapshot"][key] for key in work["world_snapshot"]} == work["world_snapshot"]


def test_delete_works_before_queue_table_exists(library):
    store, client = library
    work = create(store)
    path = f"/api/studio/works/{work['id']}?revision=1"
    assert client.delete(path).status_code == 200


def test_new_library_routes_keep_legacy_application_market_boundary(library):
    store, _ = library
    work = create(store)
    client = TestClient(main.app, headers={"host": "juben.onesay.top", "X-Duanju-Site": "china"})
    assert client.get("/api/studio/works?view=summary").status_code == 404
    assert client.patch(f"/api/studio/works/{work['id']}/archive", json={"revision": 1, "archived": True}).status_code == 404
    assert client.delete(f"/api/studio/works/{work['id']}?revision=1").status_code == 404
    assert store.get("works", work["id"]) == work
