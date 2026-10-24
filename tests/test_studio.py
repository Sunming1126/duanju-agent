"""In-process API checks: no server, scheduler, credentials or live generation."""
import asyncio

import httpx
import pytest
from fastapi import HTTPException

import main
from agent import studio_api as api
from agent.studio_store import StudioStore


@pytest.fixture
def studio(tmp_path, monkeypatch):
    storage = StudioStore(tmp_path / 'studio.sqlite3')
    monkeypatch.setattr(api, 'store', storage)
    monkeypatch.setattr(api.llm, '_refresh_config', lambda: None)
    monkeypatch.setattr(api.llm, 'API_KEY', 'test-only')
    calls = []

    class Knowledge:
        items = [dict(id='cn-script', title='中文短剧', market='china', output_locale='zh-CN', content_type='short_drama'),
                 dict(id='cn-novel', title='中文小说', market='china', output_locale='zh-CN', content_type='novel'),
                 dict(id='jp-novel', title='日本小说', market='japan', output_locale='ja-JP', content_type='novel')]

        def search(self, query, top_k, market, locale, content_type):
            return [item for item in self.items if item['market'] == market and item['content_type'] == content_type][:top_k]

    async def chat(messages, **kwargs):
        calls.append(messages)
        return '候选正文：她推开城门，看见昨日留下的信。'

    monkeypatch.setattr(api, 'get_kb', lambda: Knowledge())
    monkeypatch.setattr(api.llm, 'chat', chat)
    return storage, calls


def request(method, path, body=None, headers=None):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://localhost') as client:
            return await client.request(method, '/api/studio' + path, json=body, headers=headers or {'X-Duanju-Site': 'china'})
    return asyncio.run(run())


def create_work(**changes):
    payload = dict(title='归城', content_type='novel', units=3, premise='寻找一封失踪的信')
    payload.update(changes)
    response = request('POST', '/works', payload)
    assert response.status_code == 200, response.text
    return response.json()


def editable(record):
    return {key: value for key, value in record.items() if key not in {'id', 'created_at', 'updated_at'}}


def generate(work, action='chapter', number=1):
    response = request('POST', f"/works/{work['id']}/generate", dict(action=action, number=number, revision=work['revision']))
    assert response.status_code == 202, response.text
    return response.json()['id']


def test_status_and_market_isolation(studio):
    response = request('GET', '/status')
    assert response.status_code == 200
    assert response.json()['llm_ready'] is True
    assert 'test-only' not in response.text
    assert request('GET', '/status', headers={'host': 'juben.onesay.top', 'X-Duanju-Site': 'china'}).status_code == 404


def test_world_import_revision_and_persistence(studio):
    world = request('POST', '/worlds', dict(name='雾城', sections={'world_rules': '不可逆转时间'})).json()
    package = request('GET', f"/worlds/{world['id']}/export").json()
    imported = request('POST', '/worlds/import', package)
    assert imported.status_code == 200, imported.text
    assert imported.json()['id'] != world['id']
    assert imported.json()['sections'] == world['sections']
    package['world']['name'] = '损坏包'
    assert request('POST', '/worlds/import', package).status_code == 422
    assert request('POST', '/worlds', dict(name='无效', sections={'unknown': 'x'})).status_code == 422
    changed = editable(world)
    changed['description'] = '变更说明'
    assert request('PUT', f"/worlds/{world['id']}", changed).status_code == 200
    assert request('PUT', f"/worlds/{world['id']}", changed).status_code == 409
    assert StudioStore(studio[0].path).get('worlds', world['id'])['description'] == '变更说明'


@pytest.mark.parametrize('kind', ['novel', 'short_drama'])
def test_generation_is_candidate_until_adopted(studio, kind):
    world = request('POST', '/worlds', dict(name='雾城', sections={'world_rules': '不可逆转时间'})).json()
    work = create_work(content_type=kind, world_id=world['id'], chapters=[dict(number=1, title='前文', content='门外传来钟声。')])
    candidate_id = generate(work, number=2)
    saved = request('GET', f"/works/{work['id']}").json()
    assert saved['chapters'] == work['chapters']
    assert len(studio[1]) == 1
    messages = studio[1][0]
    assert '不可逆转时间' in messages[1]['content']
    assert '门外传来钟声' in messages[1]['content']
    assert ('中文小说家' in messages[0]['content']) == (kind == 'novel')
    rows = request('GET', f"/works/{work['id']}/candidates").json()['items']
    assert rows[0]['status'] == 'proposed'
    assert 'work_snapshot' not in rows[0]
    # Generation freezes the work's private world, not the mutable library row.
    assert rows[0]['world_revision'] is None
    adopted = request('POST', f"/works/{work['id']}/candidates/{candidate_id}/adopt")
    assert adopted.status_code == 200, adopted.text
    assert adopted.json()['revision'] == 2
    assert len(adopted.json()['chapters']) == 2
    assert request('POST', f"/works/{work['id']}/candidates/{candidate_id}/adopt").json()['revision'] == 2
    assert '候选正文' in request('GET', f"/works/{work['id']}/export").text


@pytest.mark.parametrize('owner', ['work', 'world'])
def test_stale_candidate_never_overwrites(studio, owner):
    world = request('POST', '/worlds', dict(name='雾城')).json()
    work = create_work(world_id=world['id'])
    candidate_id = generate(work)
    if owner == 'work':
        changed = editable(work)
        changed['premise'] = '人工修改'
        assert request('PUT', f"/works/{work['id']}", changed).status_code == 200
    else:
        changed = editable(work)
        changed['world_snapshot']['description'] = '作品世界副本修改'
        assert request('PUT', f"/works/{work['id']}", changed).status_code == 200
    assert request('POST', f"/works/{work['id']}/candidates/{candidate_id}/adopt").status_code == 409
    assert request('GET', f"/works/{work['id']}").json()['chapters'] == []


def test_missing_key_failure_and_no_fake_fallback(studio, monkeypatch):
    work = create_work()
    monkeypatch.setattr(api.llm, 'API_KEY', '')
    assert request('POST', f"/works/{work['id']}/generate", dict(action='chapter', revision=1)).status_code == 503
    assert studio[0].list('candidates', work['id']) == []
    monkeypatch.setattr(api.llm, 'API_KEY', 'test-only')

    async def fail(*args, **kwargs):
        return None

    monkeypatch.setattr(api.llm, 'chat', fail)
    candidate_id = generate(work)
    assert studio[0].get('candidates', candidate_id)['status'] == 'failed'
    assert studio[0].get('works', work['id'])['chapters'] == []


def test_validation_legacy_import_and_reference_isolation(studio):
    first = create_work(legacy_id='browser-v1:old')
    second = create_work(legacy_id='browser-v1:old', title='不覆盖')
    assert first == second
    assert request('POST', '/works', dict(title='x', world_id='missing')).status_code == 404
    assert request('POST', '/works', dict(title='x', units=1, chapters=[dict(number=2)])).status_code == 422
    assert request('POST', '/works', dict(title='x', chapters=[dict(number=1), dict(number=1)])).status_code == 422
    assert request('POST', '/works', dict(title='x', output_locale='ja-JP')).status_code == 422
    assert [item['id'] for item in request('GET', '/references?content_type=novel').json()['items']] == ['cn-novel']
    assert request('GET', '/references/jp-novel').status_code == 404
    assert request('GET', '/references?query=故事&content_type=short_drama').json()['items'][0]['id'] == 'cn-script'


def test_pending_restart_and_cross_work_adoption(studio):
    work = create_work()
    candidate = studio[0].begin_candidate(work['id'], 'chapter', 1, 1)
    with pytest.raises(HTTPException) as error:
        studio[0].begin_candidate(work['id'], 'chapter', 1, 1)
    assert error.value.status_code == 409
    studio[0].recover_interrupted()
    assert studio[0].get('candidates', candidate['id'])['status'] == 'failed'
    assert studio[1] == []
    candidate_id = generate(work)
    other = create_work(title='另一作品')
    assert request('POST', f"/works/{other['id']}/candidates/{candidate_id}/adopt").status_code == 404


def test_context_limits_do_not_call_model(studio):
    work = create_work(premise='设' * 40000, characters='人' * 40000)
    candidate_id = generate(work)
    assert studio[0].get('candidates', candidate_id)['status'] == 'failed'
    assert studio[1] == []


def test_local_startup_can_disable_all_automatic_remote_work(studio, monkeypatch):
    monkeypatch.setenv('DUANJU_SCHEDULER_ENABLED', 'false')
    monkeypatch.setenv('DUANJU_WRITER_AUTO_RESUME_ENABLED', 'false')
    monkeypatch.setattr(main, 'studio_store', studio[0])
    monkeypatch.setattr(main.hooks_mod, 'ensure_seed', lambda: None)
    monkeypatch.setattr(main, '_cleanup_stale_writer_tasks', lambda: None)
    monkeypatch.setattr(main, '_sync_library_from_graph', lambda: None)

    def forbidden():
        raise AssertionError('automatic remote work must stay disabled')

    monkeypatch.setattr(main.scheduler, 'start', forbidden)
    monkeypatch.setattr(main, '_writer_auto_resume_loop', forbidden)

    async def run():
        async with main.lifespan(main.app):
            pass

    asyncio.run(run())
