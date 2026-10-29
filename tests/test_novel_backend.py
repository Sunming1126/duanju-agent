"""Novel policy contracts and real persistence, with isolated storage and no model API."""
import asyncio
import copy
import json
import uuid

import pytest

import studio_main
from agent import studio_api as api, studio_novel as novel, studio_drama as drama
from agent.studio_jobs import JobInput, JobStore, execute, messages_for
from agent.studio_outline import combined_outline
from agent.studio_store import StudioStore
from agent.studio_writing import normalized_work
from studio_test_scope import browser_scope


PROSE = '我把收据折成两半，塞进她留下的旧信封。柜台上的茶已经凉了，纸角一碰杯沿就软了下来。\n“明天再来吧。”我说。门外的人没有走。我只好把信封翻过来，背面还印着旧地址。'


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = StudioStore(tmp_path / 'novel.sqlite3')
    monkeypatch.setattr(api, 'store', store)
    monkeypatch.setattr(api, 'reference_context', lambda work: [])
    with browser_scope(studio_main.app):
        yield store, JobStore(store)


def work(store, **changes):
    return store.create_work(api.WorkInput.model_validate({
        'title': '收据', 'content_type': 'novel', 'units': 5,
        'premise': '一个女儿整理旧收据，逐渐理解父亲隐瞒的生活。', **changes,
    }).model_dump())


def create(jobs, saved, **changes):
    return jobs.create(saved['id'], JobInput(revision=saved['revision'], request_key=str(uuid.uuid4()), **changes))


def context(messages):
    return json.loads(messages[1]['content'].split('\n任务：')[0].split('\n', 1)[1])


@pytest.mark.parametrize('action', ['premise', 'characters', 'outline', 'chapter', 'world'])
def test_novel_policy_is_used_by_both_paths_without_drama_calls(setup, monkeypatch, action):
    store, jobs = setup
    saved = work(store, novel_settings={'perspective': 'first_person', 'pacing': 'slow_burn'},
                 creative={'source_text': '场1 店铺 日 内\n父亲：这是原始改编素材。'},
                 world_snapshot={'name': '旧城', 'sections': {'facts': '收据只能由店主开具'}})
    def forbidden(*args, **kwargs):
        raise AssertionError('novel used drama policy')
    for name in ('writing_context', 'system_prompt', 'step_instruction'):
        monkeypatch.setattr(drama, name, forbidden)
    job = create(jobs, saved, action=action)
    original = copy.deepcopy(job)
    queued = messages_for(job, job['steps'][0], [])
    legacy = api.build_messages({'work_snapshot': saved, 'world_snapshot': saved['world_snapshot'],
                                 'action': action, 'number': 1}, [])
    assert context(queued) == context(legacy)
    assert '第一人称' in context(queued)['创作类型与专属参数']['叙事视角']
    assert '收据只能由店主开具' in queued[1]['content']
    assert '这是原始改编素材' in queued[1]['content']
    assert job == original and store.get('works', saved['id']) == saved
    if action == 'chapter':
        assert '只返回JSON对象' in queued[1]['content']
        assert '只返回JSON对象' not in legacy[1]['content']


def test_chapter_context_orders_prose_and_separates_references_from_canon(setup):
    store, jobs = setup
    saved = work(store, chapters=[{'number': n, 'title': f'章{n}', 'content': f'第{n}章开头' + '旧事' * 600 + f'第{n}章结束'} for n in (3, 1, 2)])
    job = create(jobs, saved, action='chapter', number=4)
    data = context(messages_for(job, job['steps'][0], [
        {'id': 'novel', 'content_type': 'novel', 'logline': '参考梗概', 'hook': '不要套用的钩子', 'beats': ['三秒反转']},
        {'id': 'script', 'content_type': 'short_drama', 'logline': '不应进入的剧本'},
    ]))
    assert [c['number'] for c in data['最近正文']] == [2, 3]
    excerpt = data['此前事实摘要'][0]['旧稿节选（非完整摘要）']
    assert excerpt['开头'].startswith('第1章开头') and excerpt['结尾'].endswith('第1章结束')
    refs = data['参考资料（仅借鉴，不是本书事实）']
    assert len(refs) == 1 and refs[0]['id'] == 'novel' and 'hook' not in refs[0] and 'beats' not in refs[0]
    assert '剧本参数' not in data['创作类型与专属参数']


@pytest.mark.parametrize('canonical', [False, True])
def test_focus_supports_multiline_and_editor_outline_without_future_spoilers(canonical):
    raw = '【粗纲】\n她寻找旧收据，误解逐渐化开，在结尾终于理解父亲多年的隐瞒并作出自己的选择。\n【章节大纲】\n' + '\n'.join(
        f'第{n}章：任务{n}\n人物作出选择{n}。\n后果{n}。' for n in range(1, 6))
    outline = combined_outline(raw, 'novel', 5) if canonical else raw
    focused = novel.outline_focus(outline, 2)
    assert '任务2' in focused['本章任务'] and '后果2' in focused['本章任务']
    assert '任务1' in focused['前章计划（以实际正文为准）']
    assert '任务3' in focused['下章边界（不要提前兑现）']
    assert '任务5' not in json.dumps(focused, ensure_ascii=False)


@pytest.mark.parametrize('outline', ['自由格式，不能推断哪里是本章。', '第1章：旧稿\n第1章：重复编号', '【Plotloom 大纲 v1】\n损坏的结构'])
def test_ambiguous_outline_is_preserved_in_full(outline):
    assert novel.outline_focus(outline, 1) == {'完整大纲（未可靠拆分）': outline}


def test_separate_jobs_reuse_only_summaries_matching_saved_text_and_owner(setup):
    store, jobs = setup
    saved = work(store)
    first = create(jobs, saved, action='chapter')
    async def generate(*args, **kwargs):
        return json.dumps({'text': PROSE, 'summary': '我把收据放进旧信封，还没告诉门外的人。'}, ensure_ascii=False)
    done = asyncio.run(execute(jobs, jobs.claim(), generate))
    assert done['status'] == 'completed'
    # An unadopted draft is never a source of canon.
    pending = create(jobs, saved, action='chapter', number=2)
    assert pending['continuity'] == []
    jobs.control(pending['id'], 'stop')
    unadopted = work(store)
    other = create(jobs, unadopted, action='chapter', number=2)
    assert other['continuity'] == []
    jobs.control(other['id'], 'stop')
    saved = jobs.adopt(first['id'])
    second = create(jobs, saved, action='chapter', number=2)
    assert second['continuity'] == [{'number': 1, 'summary': '我把收据放进旧信封，还没告诉门外的人。'}]
    jobs.control(second['id'], 'stop')
    # Source text changes invalidate the summary, even though the number is unchanged.
    saved['chapters'][0]['content'] = '作者手改了本章，事情并未按原稿发生。'
    saved = store.update_work(saved['id'], {k: v for k, v in saved.items() if k in api.WorkInput.model_fields}, saved['revision'])
    third = create(jobs, saved, action='chapter', number=2)
    assert third['continuity'] == []
    copied = copy.deepcopy(done)
    copied['owner_id'] = 'a-different-space'
    saved['chapters'][0]['content'] = PROSE
    assert novel.matching_continuity(saved, [copied]) == []


def test_continuation_keeps_original_and_budget_failure_makes_no_model_call(setup):
    store, jobs = setup
    saved = work(store, chapters=[{'number': 1, 'title': '自定义章名', 'content': PROSE}])
    job = create(jobs, saved, action='chapter', continuation=True)
    messages = messages_for(job, job['steps'][0], [])
    assert context(messages)['本单元原稿'][0]['content'] == PROSE
    assert '保留本单元原稿的每个字' in messages[1]['content']
    with pytest.raises(ValueError, match='未删减'):
        novel.messages_for(normalized_work(saved), 'chapter', 1, [], world={'rules': '完整规则' * 100}, max_context=100)


@pytest.mark.parametrize('text', [
    '场1 店铺 日 内\n父亲：收据呢？', '内景：店铺\n父亲进门。', 'INT. SHOP - DAY\nFATHER: Where is it?',
    '父亲：给我。\n女儿：不给。\n父亲：为什么？', '【本章任务】\n视角人物寻找收据。',
])
def test_novel_guard_rejects_script_and_planning_but_never_retries(setup, text):
    store, jobs = setup
    saved = work(store)
    create(jobs, saved, action='chapter')
    calls = []
    async def generate(*args, **kwargs):
        calls.append(kwargs)
        return json.dumps({'text': text + '\n' + '这是无效格式的模型输出。' * 8, 'summary': '测试摘要'}, ensure_ascii=False)
    result = asyncio.run(execute(jobs, jobs.claim(), generate))
    assert result['status'] == 'failed' and result['results'] == []
    assert len(calls) == 1 and calls[0]['retries'] == 1
    assert store.get('works', saved['id'])['chapters'] == []


@pytest.mark.parametrize('text', [PROSE, '“场1 店铺 日 内，这是你写的剧本？”她问。\n她没有翻开第二页。', '他心中涌起一阵熟悉的酸意，仍旧把信递了出去。'])
def test_format_guard_is_not_a_vocabulary_blacklist(text):
    novel.validate_chapter_format(text)
