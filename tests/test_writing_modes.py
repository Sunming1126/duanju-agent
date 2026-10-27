"""Regressions for immutable entry types, distinct settings and prose/script output."""
import asyncio
import copy
import json
import uuid

import pytest
from fastapi.testclient import TestClient

import main
import studio_main
from agent import studio_api as api
from agent.studio_jobs import JobInput, JobStore, execute, messages_for
from agent.studio_store import StudioStore
from agent.studio_writing import canonical_mode, validate_chapter_format
from studio_test_scope import browser_scope


PROSE = '我推开修表铺的门，钟摆恰好停在半空。妹妹寄来的信躺在柜台上，纸边沾着昨夜的雨。我知道自己必须读完它，即使每一个字都可能改变我记得的过去。\n“你终于来了。”老人轻声说。\n我把信收进口袋，决定先去见那个失踪多年的邮差。'
SCRIPT = '场1 修表铺 日 内\n出场人物：林禾、老人\n△林禾推门进入，柜台上的信被风吹落。老人伸手挡住她。\n老人：你终于来了。\n林禾：这封信为什么会写着明天的日期？\n△老人看向墙上的钟，钟摆突然停止。'


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = StudioStore(tmp_path / 'writing.sqlite3')
    monkeypatch.setattr(api, 'store', store)
    monkeypatch.setattr(api.llm, '_refresh_config', lambda: None)
    monkeypatch.setattr(api.llm, 'API_KEY', 'offline-only')
    monkeypatch.setattr(api, 'reference_context', lambda work: [])
    with browser_scope(studio_main.app) as client:
        yield store, JobStore(store), client


@pytest.mark.parametrize('kind,mode,expected', [('novel','新建剧本','小说创作'), ('novel','剧本改写','小说创作'), ('short_drama','小说创作','剧本创作'), ('short_drama','小说改编','小说改编'), ('novel','灵感策划','灵感创作')])
def test_mode_is_normalized_to_the_declared_content_type(kind, mode, expected):
    work = api.WorkInput(title='模式检查', content_type=kind, mode=mode)
    assert work.mode == expected == canonical_mode(kind, mode)
    if kind == 'novel':
        assert work.novel_settings and work.drama_settings is None
        assert work.words_per_chapter == 2000
    else:
        assert work.drama_settings and work.novel_settings is None


def test_specific_parameters_and_length_limits_are_not_interchangeable(setup):
    _, _, client = setup
    for data in ({'content_type':'novel','drama_settings':{}}, {'content_type':'short_drama','novel_settings':{}},
                 {'content_type':'novel','novel_settings':{'perspective':'camera'}}, {'content_type':'short_drama','drama_settings':{'minutes_per_episode':60}},
                 {'content_type':'short_drama','words_per_chapter':6000}):
        assert client.post('/api/studio/works', json={'title':'参数检查', **data}).status_code == 422
    created = client.post('/api/studio/works', json={'title':'长章','content_type':'novel','words_per_chapter':6000})
    assert created.status_code == 200 and created.json()['novel_settings']['perspective'] == 'third_limited'


def test_existing_work_cannot_switch_type_and_backup_retains_settings(setup):
    store, _, client = setup
    source = client.post('/api/studio/works', json={'title':'类型固定','content_type':'novel','novel_settings':{'perspective':'first_person','pacing':'slow_burn'}}).json()
    update = {key:value for key,value in source.items() if key not in {'id','created_at','updated_at'}}
    update.update(content_type='short_drama', novel_settings=None, drama_settings={})
    assert client.put(f"/api/studio/works/{source['id']}", json=update).status_code == 409
    assert {key:value for key,value in store.get('works',source['id']).items() if key != 'owner_id'} == source
    backup = client.get(f"/api/studio/works/{source['id']}/backup").json()
    restored = client.post('/api/studio/works/import', json=backup).json()
    assert restored['novel_settings'] == source['novel_settings']


@pytest.mark.parametrize('action',['premise','characters','outline','chapter'])
def test_legacy_novel_mode_is_repaired_only_for_generation_context(setup, action):
    store, jobs, _ = setup
    work = store.create_work(api.WorkInput(title='旧小说', content_type='novel', premise='寻找来信', novel_settings={'perspective':'first_person'}).model_dump())
    # Simulate records created by the old API default; no migration of prose.
    with store.transaction() as db:
        work['mode'] = '新建剧本'
        store.write(db,'works',work)
    body = JobInput(action=action, revision=1, request_key=str(uuid.uuid4()))
    job = jobs.create(work['id'],body)
    frozen = copy.deepcopy(job)
    messages = messages_for(job,job['steps'][0],[])
    context = json.loads(messages[-1]['content'].split('\n任务：')[0].split('\n',1)[1])
    assert context['作品']['mode'] == '小说创作'
    assert context['作品']['content_type'] == 'novel'
    assert '第一人称' in context['创作类型与专属参数']['叙事视角']
    assert '禁止场次编号' in messages[0]['content']
    assert '剧本参数' not in context['创作类型与专属参数']
    assert job == frozen and store.get('works',work['id'])['mode'] == '新建剧本'


@pytest.mark.parametrize('kind,text,success', [('novel',PROSE,True), ('novel',SCRIPT,False), ('short_drama',SCRIPT,True), ('short_drama',PROSE,False)])
def test_paid_worker_validates_format_before_saving_candidate(setup, kind, text, success):
    store,jobs,_ = setup
    work = store.create_work(api.WorkInput(title='正文检查',content_type=kind,premise='寻找来信').model_dump())
    job = jobs.create(work['id'], JobInput(action='chapter',revision=1,request_key=str(uuid.uuid4())))
    calls = []
    async def generate(messages,**kwargs):
        calls.append(kwargs)
        return json.dumps({'text':text,'summary':'林禾收到来信，准备寻找寄信者。'},ensure_ascii=False)
    result = asyncio.run(execute(jobs,jobs.claim(),generate))
    assert result['status'] == ('completed' if success else 'failed')
    assert len(calls) == 1 and calls[0]['retries'] == 1
    assert not store.get('works',work['id'])['chapters']
    if success:
        assert jobs.adopt(job['id'])['chapters'][0]['content'] == text
    else:
        assert not result['results']


def test_novel_may_mention_screenplays_without_being_rejected():
    validate_chapter_format('novel', '她把剧本放在桌上，回忆起第一场比赛时的紧张。\n“我不想再演了。”她轻声说。')
    with pytest.raises(ValueError):
        validate_chapter_format('novel','林禾：你来了。\n老人：是的。\n林禾：信在哪里？\n老人：柜台上。')


def test_legacy_background_path_uses_the_same_format_guard(setup, monkeypatch):
    store,_,primary = setup
    work=store.create_work(api.WorkInput(title='旧路径',content_type='novel',premise='寻找来信').model_dump())
    async def wrong(*args, **kwargs): return SCRIPT
    monkeypatch.setattr(api.llm,'chat',wrong)
    client=TestClient(main.app, cookies=primary.cookies)
    response=client.post(f"/api/studio/works/{work['id']}/generate",json={'action':'chapter','revision':1},headers={'X-Duanju-Site':'china'})
    assert response.status_code == 202
    assert store.get('candidates',response.json()['id'])['status'] == 'failed'
    assert not store.get('works',work['id'])['chapters']
