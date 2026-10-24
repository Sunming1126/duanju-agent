"""Isolated MVP verification. Never uses a real key or user's databases."""
import asyncio
import json
import re
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import studio_main
from agent import studio_api as api
from agent.studio_jobs import JobStore, JobInput, execute
from agent.studio_store import StudioStore
from agent.studio_worker import lock_worker


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = StudioStore(tmp_path / 'studio.sqlite3')
    monkeypatch.setattr(api, 'store', store)
    monkeypatch.setattr(api.llm, '_refresh_config', lambda: None)
    monkeypatch.setattr(api.llm, 'API_KEY', 'offline-test-only')
    monkeypatch.setattr(api, 'reference_context', lambda work: [])
    return store, JobStore(store)


def work(store, **changes):
    return store.create_work(api.WorkInput.model_validate(dict({'title':'归城', 'premise':'找回失踪的信件', 'content_type':'novel', 'units':3}, **changes)).model_dump())


def create(jobs, w, **changes):
    return jobs.create(w['id'], JobInput(revision=w['revision'], request_key=str(uuid.uuid4()), **changes))


async def fake(messages, **kwargs):
    text = messages[-1]['content']
    task = text.split('\n任务：')[-1]
    if '只返回JSON对象' in task and 'summary' in task:
        number = int(re.search(r'写第(\d+)', task)[1])
        return json.dumps({'text': f'第{number}章，她推开门，街角传来钟声。' * 12, 'summary': f'第{number}章：收到新的线索，保留旧信。'}, ensure_ascii=False)
    if '为全部' in task:
        count = int(re.search(r'为全部(\d+)', task)[1])
        return '\n'.join(f'第{n}章：寻找线索，遇到冲突，发现转折。' for n in range(1, count + 1))
    if '完善作品世界' in task:
        return json.dumps({'name': '雾城', 'description': '新的候选世界', 'sections': {'world_rules': '时间不可逆转'}}, ensure_ascii=False)
    return '她想找回遗失的信件，但必须先面对自己曾经隐瞒的事实。' * 3


def run(jobs, generate=fake):
    claimed = jobs.claim()
    assert claimed
    return asyncio.run(execute(jobs, claimed, generate))


def test_all_200_units_is_complete_independent_draft(setup):
    store, jobs = setup
    w = work(store, units=200)
    job = create(jobs, w, mode='all')
    result = run(jobs)
    assert result['status'] == 'completed'
    assert len(result['results']) == 203
    assert [c['number'] for c in result['draft']['chapters']] == list(range(1, 201))
    assert not store.get('works', w['id'])['chapters']
    adopted = jobs.adopt(job['id'])
    assert len(adopted['chapters']) == 200
    assert jobs.adopt(job['id'])['revision'] == adopted['revision']


def test_failure_resume_does_not_repeat_finished_steps(setup):
    store, jobs = setup
    w = work(store)
    job = create(jobs, w, mode='all')
    calls = []
    async def failing(messages, **kw):
        calls.append(messages)
        if len(calls) == 3:
            return None
        return await fake(messages)
    failed = run(jobs, failing)
    assert failed['status'] == 'failed' and len(failed['results']) == 2
    jobs.control(job['id'], 'resume')
    finished = run(jobs)
    assert finished['status'] == 'completed'
    assert len(finished['results']) == 6
    assert finished['results'][:2] == failed['results']


def test_stop_saves_inflight_result_and_resume(setup):
    store, jobs = setup
    job = create(jobs, work(store), mode='all')
    async def stopping(messages, **kw):
        jobs.control(job['id'], 'stop')
        return await fake(messages)
    stopped = run(jobs, stopping)
    assert stopped['status'] == 'stopped' and len(stopped['results']) == 1
    jobs.control(job['id'], 'resume')
    assert run(jobs)['status'] == 'completed'


def test_cancel_queued_and_idempotency_and_queue_capacity(setup):
    store, jobs = setup
    w = work(store)
    body = JobInput(revision=w['revision'], request_key='identical-request')
    first = jobs.create(w['id'], body)
    assert jobs.create(w['id'], body)['id'] == first['id']
    with pytest.raises(HTTPException) as err:
        create(jobs, w)
    assert err.value.status_code == 409
    jobs.control(first['id'], 'stop')
    for n in range(10):
        create(jobs, work(store, title=f'排队{n}'))
    with pytest.raises(HTTPException) as err:
        create(jobs, work(store))
    assert err.value.status_code == 429


def test_recovery_belongs_to_worker_and_lock_is_exclusive(setup):
    store, jobs = setup
    job = create(jobs, work(store), mode='all')
    jobs.claim()
    # API / store recreation does not interrupt the running worker.
    assert JobStore(StudioStore(store.path)).get(job['id'])['status'] == 'running'
    with lock_worker(store.path):
        with pytest.raises(OSError):
            lock_worker(store.path)
        jobs.recover()
    assert jobs.get(job['id'])['status'] == 'interrupted'
    assert jobs.claim() is None
    jobs.control(job['id'], 'resume')
    assert run(jobs)['status'] == 'completed'


def test_independent_world_snapshots_and_reviewed_world_candidate(setup):
    store, jobs = setup
    source = store.create_world(api.WorldInput(name='原件', sections={'facts': '已确认事实'}).model_dump())
    a = work(store, world_id=source['id'])
    b = work(store, world_id=source['id'])
    store.update_world(source['id'], {'sections': {'facts': '原件变更'}}, source['revision'])
    assert store.get('works', a['id'])['world_snapshot']['sections']['facts'] == '已确认事实'
    a['world_snapshot']['sections']['facts'] = '作品A改动'
    a = store.update_work(a['id'], {k:v for k,v in a.items() if k in api.WorkInput.model_fields}, a['revision'])
    assert store.get('works', b['id'])['world_snapshot']['sections']['facts'] == '已确认事实'
    job = create(jobs, a, action='world')
    run(jobs)
    assert store.get('works', a['id'])['world_snapshot']['name'] == '原件'
    assert jobs.adopt(job['id'])['world_snapshot']['name'] == '雾城'
    assert store.get('worlds', source['id'])['sections']['facts'] == '原件变更'


def test_partial_adoption_and_external_revision_conflicts(setup):
    store, jobs = setup
    w = work(store)
    job = create(jobs, w, mode='all')
    run(jobs)
    partial = jobs.adopt(job['id'], 0)
    assert partial['premise'] != w['premise']
    assert jobs.adopt(job['id'], 1)['revision'] == partial['revision'] + 1
    latest = store.get('works', w['id'])
    store.update_work(w['id'], {'title': '外部编辑'}, latest['revision'])
    with pytest.raises(HTTPException) as err:
        jobs.adopt(job['id'])
    assert err.value.status_code == 409
    assert len(jobs.get(job['id'])['draft']['chapters']) == 3


@pytest.mark.parametrize('response', ['', '正文太短', '{"text":"正文缺少摘要"}', '{broken json'])
def test_invalid_output_is_not_a_fake_success(setup, response):
    store, jobs = setup
    job = create(jobs, work(store), action='chapter')
    async def invalid(*args, **kw):
        return response
    result = run(jobs, invalid)
    assert result['status'] == 'failed' and not result['results']
    assert not store.get('works', job['work_id'])['chapters']


def test_missing_outline_numbers_stop_all_generation(setup):
    store, jobs = setup
    create(jobs, work(store), mode='all')
    async def incomplete(messages, **kw):
        if '任务：为全部' in messages[-1]['content']:
            return '第1章：只有第一章，不代表全部单元已经完成。'
        return await fake(messages)
    result = run(jobs, incomplete)
    assert result['status'] == 'failed' and len(result['results']) == 2


def test_public_api_backup_import_archive_and_guards(setup):
    store, jobs = setup
    client = TestClient(studio_main.app)
    assert client.get('/api/studio/status').status_code == 200
    for path in ['/api/llm/config', '/api/refresh', '/api/writer/tasks', '/api/backend/llm/config', '/openapi.json']:
        assert client.get(path).status_code == 404
        assert client.post(path, json={}).status_code == 404
    assert 'offline-test-only' not in client.get('/api/studio/status').text
    created = client.post('/api/studio/works', json={'title': '作品备份', 'premise': '设定', 'creative': {'genres': ['悬疑'], 'core': ['失踪信件'], 'styles': ['温暖']}}).json()
    backup = client.get(f"/api/studio/works/{created['id']}/backup").json()
    copied = client.post('/api/studio/works/import', json=backup).json()
    assert copied['id'] != created['id'] and copied['creative'] == created['creative']
    data = {k:v for k,v in copied.items() if k in api.WorkInput.model_fields}
    data.update(revision=copied['revision'], archived=True)
    assert client.put(f"/api/studio/works/{copied['id']}", json=data).json()['archived']
    assert client.post('/api/studio/works', json={'title': '无效标签', 'creative': {'core': ['a','b','c','d']}}).status_code == 422
    world = client.post('/api/studio/worlds', json={'name': '归档世界', 'sections': {}}).json()
    world_input = {k:v for k,v in world.items() if k in api.WorldInput.model_fields}
    world_input.update(revision=1, archived=True)
    assert client.put(f"/api/studio/worlds/{world['id']}", json=world_input).json()['archived']


def test_legacy_market_is_explicit_and_import_is_idempotent(setup, tmp_path, monkeypatch):
    monkeypatch.setenv('PLOTLOOM_LEGACY_DIR', str(tmp_path))
    for name, market in [('cn', 'china'), ('jp', 'japan'), ('unknown', None)]:
        (tmp_path / f'{name}.json').write_text(json.dumps({'tid': name, 'req': {'market': market, 'episodes': 3}, 'agg': {'title': name, 'ep1_script': '旧稿原文'}}), encoding='utf-8')
    client = TestClient(studio_main.app)
    rows = client.get('/api/studio/history').json()['items']
    assert len(rows) == 1 and rows[0]['title'] == 'cn'
    path = f"/api/studio/history/{rows[0]['id']}"
    assert '旧稿原文' in client.get(path + '/preview').text
    first = client.post(path + '/import').json()
    second = client.post(path + '/import').json()
    assert first['id'] == second['id']


def test_additive_legacy_migration_keeps_original_prose(setup):
    store, jobs = setup
    source = store.create_world(api.WorldInput(name='旧世界').model_dump())
    w = work(store, world_id=source['id'], chapters=[{'number':1,'title':'旧章','content':'原文保持'}])
    import sqlite3
    with sqlite3.connect(store.path) as db:
        old = {k:v for k,v in w.items() if k not in {'world_snapshot','creative','archived'}}
        db.execute('UPDATE works SET data=? WHERE id=?', (json.dumps(old), w['id']))
        db.execute('PRAGMA user_version=0')
    migrated = StudioStore(store.path).get('works', w['id'])
    assert migrated['chapters'] == w['chapters']
    assert migrated['world_snapshot']['name'] == '旧世界'
    assert StudioStore(store.path).get('works', w['id']) == migrated


def test_truncated_provider_response_is_rejected_without_retry(setup, monkeypatch):
    import httpx
    store, jobs = setup
    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(200, json={'choices':[{'finish_reason':'length', 'message':{'content':'被截断的正文'}}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(api.llm.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(provider), **kwargs))
    create(jobs, work(store), action='chapter')
    result = run(jobs, api.llm.chat)
    assert result['status'] == 'failed' and '截断' in result['error']
    assert len(calls) == 1 and not result['results']


def test_excess_context_keeps_canon_and_does_not_charge(setup):
    store, jobs = setup
    from agent.studio_store import WORLD_FIELDS
    world = {'name':'大世界', 'description':'', 'sections': {key:'规则'*10000 for key in sorted(WORLD_FIELDS)[:5]}}
    w = work(store, premise='梗概'*25000, world_snapshot=world, creative={'source_text':'原始素材'*12500})
    create(jobs, w, action='chapter')
    calls = []
    async def forbidden(*args, **kwargs):
        calls.append(args)
        return None
    result = run(jobs, forbidden)
    assert result['status'] == 'failed' and '未删减' in result['error']
    assert not calls
