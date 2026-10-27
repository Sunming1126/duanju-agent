"""Two independent browsers, real cookie authentication, temporary data only."""
import json
import secrets

import pytest
from fastapi.testclient import TestClient

import studio_main
from agent import studio_api as api
from agent.studio_identity import COOKIE, SpaceStore
from agent.studio_store import StudioStore


@pytest.fixture
def space(tmp_path, monkeypatch):
    store = StudioStore(tmp_path / "private.sqlite3")
    monkeypatch.setattr(api, "store", store)
    monkeypatch.setattr(api.llm, "_refresh_config", lambda: None)
    monkeypatch.setattr(api.llm, "API_KEY", "offline-only")
    return store


def browser():
    client = TestClient(studio_main.app, base_url="https://testserver")
    response = client.get("/api/studio/session")
    assert response.status_code == 200
    return client, response.json(), response


def work(client, **changes):
    response = client.post("/api/studio/works", json={"title": "私人故事", "premise": "寻找失踪的信", **changes})
    assert response.status_code == 200, response.text
    return response.json()


def job(client, value, key="same-request-key"):
    response = client.post(f"/api/studio/works/{value['id']}/jobs", json={"revision": value["revision"], "request_key": key})
    assert response.status_code == 202, response.text
    return response.json()


def test_cookie_is_opaque_persistent_private_and_not_replaceable_by_owner_id(space):
    a, info, response = browser()
    b, other, _ = browser()
    assert info["space_id"] != other["space_id"]
    assert a.get("/api/studio/session").json() == info
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie
    token = a.cookies.get(COOKIE)
    assert token not in response.text and token != info["space_id"]
    with space.transaction() as db:
        values = [dict(row) for row in db.execute("SELECT * FROM studio_spaces")]
    assert token not in json.dumps(values)
    anonymous = TestClient(studio_main.app)
    assert anonymous.get("/api/studio/works").status_code == 401
    assert anonymous.get("/api/studio/works", headers={"X-Plotloom-Space": info["space_id"]}).status_code == 401
    anonymous.cookies.set(COOKIE, info["space_id"])
    assert anonymous.get("/api/studio/works").status_code == 401
    value = work(a)
    assert "owner_id" not in value
    assert a.get("/api/studio/works").headers["cache-control"] == "no-store, private"
    assert a.get("/api/studio/works").headers["vary"] == "Cookie"
    assert b.get("/api/studio/works").json()["items"] == []


def test_works_worlds_exports_mutations_and_job_ids_are_owner_checked(space):
    a, _, _ = browser()
    b, _, _ = browser()
    world = a.post("/api/studio/worlds", json={"name": "私人世界"}).json()
    value = work(a, world_id=world["id"])
    task = job(a, value)
    assert b.get("/api/studio/works?view=summary").json()["items"] == []
    assert b.get("/api/studio/worlds").json()["items"] == []
    paths = [f"/works/{value['id']}", f"/works/{value['id']}/backup", f"/works/{value['id']}/export", f"/works/{value['id']}/candidates", f"/works/{value['id']}/jobs", f"/worlds/{world['id']}", f"/worlds/{world['id']}/export", f"/jobs/{task['id']}", f"/jobs/{task['id']}/export"]
    for path in paths:
        assert b.get("/api/studio" + path).status_code == 404, path
    payload = {key:item for key,item in value.items() if key in api.WorkInput.model_fields} | {"revision": 1}
    assert b.put(f"/api/studio/works/{value['id']}", json=payload).status_code == 404
    assert b.patch(f"/api/studio/works/{value['id']}/archive", json={"revision":1,"archived":True}).status_code == 404
    assert b.delete(f"/api/studio/works/{value['id']}?revision=1").status_code == 404
    for path in [f"/works/{value['id']}/duplicate", f"/works/{value['id']}/world-library", f"/jobs/{task['id']}/stop", f"/jobs/{task['id']}/resume", f"/jobs/{task['id']}/adopt", f"/jobs/{task['id']}/results/0/adopt"]:
        assert b.post("/api/studio" + path, json={}).status_code == 404, path
    assert b.post(f"/api/studio/works/{value['id']}/jobs", json={"revision":1,"request_key":"other-owner-request"}).status_code == 404
    assert b.post("/api/studio/works", json={"title":"跨空间绑定", "world_id":world["id"]}).status_code == 404
    own = work(b)
    own_payload = {key:item for key,item in own.items() if key in api.WorkInput.model_fields} | {"revision":1,"world_id":world["id"]}
    assert b.put(f"/api/studio/works/{own['id']}", json=own_payload).status_code == 404
    assert b.post("/api/studio/works", json={"title":"伪造归属", "owner_id":"legacy"}).status_code == 422
    assert a.get(f"/api/studio/works/{value['id']}").json() == value
    assert "owner_id" not in a.get(f"/api/studio/jobs/{task['id']}").text


def test_idempotency_and_old_browser_draft_ids_are_namespaced_per_space(space):
    a, _, _ = browser()
    b, _, _ = browser()
    first = work(a, legacy_id="browser-v1:same-local-id")
    second = work(b, legacy_id="browser-v1:same-local-id")
    assert first["id"] != second["id"]
    assert work(a, legacy_id="browser-v1:same-local-id")["id"] == first["id"]
    ja, jb = job(a, first), job(b, second)
    assert ja["id"] != jb["id"]
    assert job(a, first)["id"] == ja["id"]
    body = {"market":"china", "output_locale":"zh-CN", "content_type":"novel", "prompt":"私人灵感", "request_key":"same-inspiration-key"}
    sa = a.post("/api/studio/inspirations", json=body).json()
    sb = b.post("/api/studio/inspirations", json=body).json()
    assert sa["id"] != sb["id"]
    assert b.get(f"/api/studio/inspirations/{sa['id']}").status_code == 404
    assert b.post(f"/api/studio/inspiration-jobs/{sa['job']['id']}/resume", json={}).status_code == 404
    assert b.post(f"/api/studio/inspirations/{sa['id']}/actions", json={"action":"analyze", "plan_id":"guess", "revision":1,"request_key":"guessing-a-plan"}).status_code == 404
    assert "owner_id" not in json.dumps(sa)


def test_cross_site_writes_are_rejected_even_with_a_valid_cookie(space):
    a, _, _ = browser()
    for headers in ({"Origin":"https://other.example"}, {"Origin":"https://["}, {"Sec-Fetch-Site":"cross-site"}):
        assert a.post("/api/studio/works", json={"title":"跨站写入"}, headers=headers).status_code == 403
    assert a.get("/api/studio/works").json()["items"] == []


def test_same_origin_writes_through_trusted_reverse_proxy(space):
    client = TestClient(studio_main.app, client=("127.0.0.1", 12345))
    assert client.get("/api/studio/session").status_code == 200
    response = client.post("/api/studio/works", json={"title":"同源代理保存"}, headers={"Origin":"https://jubencn.onesay.top", "X-Forwarded-Host":"jubencn.onesay.top"})
    assert response.status_code == 200
    assert response.json()["title"] == "同源代理保存"


def test_public_origin_survives_uvicorn_forwarded_client_address(space):
    client = TestClient(studio_main.app, base_url="http://127.0.0.1:8766", client=("203.0.113.8",12345))
    assert client.get("/api/studio/session").status_code == 200
    headers = {"Origin":"https://jubencn.onesay.top", "X-Forwarded-Host":"jubencn.onesay.top"}
    assert client.post("/api/studio/works", json={"title":"公网同源保存"}, headers=headers).status_code == 200
    headers["Origin"] = "https://untrusted.example"
    headers["X-Forwarded-Host"] = "untrusted.example"
    assert client.post("/api/studio/works", json={"title":"伪造代理头"}, headers=headers).status_code == 403


def test_existing_shared_data_is_not_claimed_by_first_visitor_and_recovery_is_one_time(space):
    source = space.create_world(api.WorldInput(name="旧共享世界").model_dump())
    old = space.create_work(api.WorkInput(title="保留旧稿", world_id=source["id"], chapters=[{"number":1,"content":"已有正文不能丢"}]).model_dump())
    from agent.studio_jobs import JobInput, JobStore
    jobs = JobStore(space)
    task = jobs.create(old["id"], JobInput(revision=1, request_key="legacy-idempotency"))
    jobs.control(task["id"], "stop")
    a, _, _ = browser()
    b, _, _ = browser()
    assert a.get("/api/studio/works").json()["items"] == []
    assert b.get(f"/api/studio/works/{old['id']}").status_code == 404
    code = secrets.token_urlsafe(32)
    SpaceStore(space).prepare_legacy_claim(code)
    assert a.post("/api/studio/session/claim-legacy", json={"code":"invalid-code-0123456789012345"}).status_code == 403
    response = a.post("/api/studio/session/claim-legacy", json={"code":code})
    assert response.status_code == 200
    assert response.json()["claimed"]["works"] == 1
    saved = a.get(f"/api/studio/works/{old['id']}").json()
    assert saved["chapters"] == old["chapters"] and saved["revision"] == old["revision"]
    assert a.get(f"/api/studio/worlds/{source['id']}").status_code == 200
    assert job(a, saved, "legacy-idempotency")["id"] == task["id"]
    assert b.get("/api/studio/works").json()["items"] == []
    assert b.post("/api/studio/session/claim-legacy", json={"code":code}).status_code == 403
    assert a.get("/api/studio/session").json()["legacy_access"] is True
