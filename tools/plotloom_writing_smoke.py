"""Opt-in real-model acceptance. Creates clearly labelled, archived test works."""
import argparse
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='https://jubencn.onesay.top/api/backend/studio')
parser.add_argument('--real-model', action='store_true')
parser.add_argument('--report', required=True)
args = parser.parse_args()
if not args.real_model:
    parser.error('--real-model is required: these checks make five explicit model calls')
base = args.base.rstrip('/')
urlopen = build_opener(HTTPCookieProcessor()).open
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
report = {'started_at': stamp, 'results': [], 'ok': False}


def api(path, body=None, method=None):
    payload = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    try:
        with urlopen(Request(base + path, data=payload, method=method,
                             headers={'Content-Type': 'application/json'}), timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        detail = json.load(error).get('detail', 'request failed')
        raise RuntimeError(f'HTTP {error.code} {path}: {detail}') from None


def event(name, **fields):
    print(json.dumps({'event': name, **fields}, ensure_ascii=True), flush=True)


def wait_session(session):
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        current = api('/inspirations/' + session['id'])
        if current['job']['status'] not in {'queued', 'running'}:
            if current['job']['status'] != 'completed':
                raise RuntimeError(f"Inspiration {current['id']} failed: {current['job']['error']}")
            return current
        time.sleep(2)
    raise RuntimeError('Inspiration acceptance timed out; retained task was not resent')


def wait_job(job):
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        current = api('/jobs/' + job['id'])
        if current['status'] not in {'queued', 'running', 'stopping'}:
            if current['status'] != 'completed':
                raise RuntimeError(f"Generation {current['id']} failed: {current['error']}")
            return current
        time.sleep(2)
    raise RuntimeError('Generation acceptance timed out; retained task was not resent')


try:
    assert api('/session')['isolated']
    assert api('/status')['llm_ready']
    request = {'market': 'china', 'output_locale': 'zh-CN', 'content_type': 'novel', 'request_key': str(uuid.uuid4()),
               'prompt': '写一个第一人称、温暖的现实小说：我在老街修表铺发现妹妹留下的一封信，与疏远的父亲一起寻找寄信人，最终和解。不要超能力或时间旅行。',
               'genres': '都市日常', 'core': '家庭和解', 'styles': '温暖', 'audience': 'general'}
    session = api('/inspirations', request)
    assert api('/inspirations', request)['id'] == session['id']
    event('inspiration_submitted', session_id=session['id'])
    session = wait_session(session)
    assert len(session['plans']) == 3
    originals = session['plans']
    event('three_plans_passed', session_id=session['id'])
    session = api('/inspirations/' + session['id'] + '/actions', {'action': 'revise', 'plan_id': originals[1]['id'],
                  'revision': session['revision'], 'request_key': str(uuid.uuid4()), 'feedback': '保留第一人称、现实背景与家庭和解，突出我和父亲从疏远到理解的过程。'})
    session = wait_session(session)
    assert session['plans'][0] == originals[0] and session['plans'][2] == originals[2]
    event('independent_revision_passed')
    session = api('/inspirations/' + session['id'] + '/actions', {'action': 'analyze', 'plan_id': originals[1]['id'],
                  'revision': session['revision'], 'request_key': str(uuid.uuid4())})
    session = wait_session(session)
    analyzed = session['analysis']
    assert analyzed['content_type'] == 'novel' and analyzed['mode'] == '灵感创作'
    assert analyzed['world_snapshot']['sections']['world_rules']
    assert analyzed['creative']['core'] and analyzed['creative']['highlights']
    report['inspiration_session_id'] = session['id']
    event('analysis_fields_passed')

    from agent.studio_writing import validate_chapter_format
    for kind in ('novel', 'short_drama'):
        body = ({**analyzed, 'title': f'上线验收·类型修复·小说·{stamp}', 'mode': '新建剧本', 'units': 1, 'words_per_chapter': 500,
                 'novel_settings': {'form': 'short_story', 'perspective': 'first_person', 'prose_style': 'natural', 'pacing': 'balanced'}, 'drama_settings': None}
                if kind == 'novel' else {'title': f'上线验收·类型修复·短剧·{stamp}', 'content_type': kind, 'units': 1, 'words_per_chapter': 500,
                    'premise': '修表铺女孩发现妹妹留下的旧信，与父亲一起解开误会，现实温暖，不涉及时间旅行。',
                    'drama_settings': {'format': 'horizontal_short', 'minutes_per_episode': 3, 'scene_density': 'compact', 'hook_style': 'suspense'}})
        work = api('/works', body)
        try:
            assert work['mode'] == ('小说创作' if kind == 'novel' else '剧本创作')
            assert not work['chapters']
            job_input = {'action': 'chapter', 'number': 1, 'revision': work['revision'], 'request_key': str(uuid.uuid4())}
            job = api(f"/works/{work['id']}/jobs", job_input)
            assert api(f"/works/{work['id']}/jobs", job_input)['id'] == job['id']
            event('chapter_submitted', kind=kind, work_id=work['id'], job_id=job['id'])
            job = wait_job(job)
            assert len(job['results']) == 1
            text = job['results'][0]['text']
            validate_chapter_format(kind, text)
            assert not api('/works/' + work['id'])['chapters']
            work = api('/jobs/' + job['id'] + '/adopt', {})
            assert work['chapters'][0]['content'] == text
            if kind == 'novel':
                assert '我' in text and work['novel_settings']['perspective'] == 'first_person'
            report['results'].append({'kind': kind, 'work_id': work['id'], 'job_id': job['id'], 'characters': len(text),
                                      'preview': text[:180], 'mode': work['mode'], 'format_and_adoption': 'passed'})
            event('chapter_format_and_adoption_passed', kind=kind, characters=len(text))
        finally:
            latest = api('/works/' + work['id'])
            payload = {key: value for key, value in latest.items() if key not in {'id', 'created_at', 'updated_at'}}
            payload['archived'] = True
            api('/works/' + work['id'], payload, 'PUT')
    report['ok'] = True
except Exception as error:
    report['error'] = str(error)
    raise
finally:
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    event('acceptance_report', ok=report['ok'], path=args.report)
