"""Controlled real-model HTTP acceptance: two small works, no secrets printed."""
import json
import sys
import time
import uuid
from urllib.request import Request, urlopen
from urllib.error import HTTPError

base = (sys.argv[1] if len(sys.argv) > 1 else 'https://jubencn.onesay.top').rstrip('/')
prefix = '/api/backend/studio'

def api(path, body=None, method=None):
    req = Request(base + prefix + path, data=json.dumps(body).encode() if body is not None else None,
                  method=method, headers={'Content-Type':'application/json'})
    with urlopen(req, timeout=30) as response:
        raw = response.read().decode()
        return json.loads(raw) if 'json' in response.headers.get('Content-Type', '') else raw

def payload(work):
    return {k:v for k,v in work.items() if k not in {'id','created_at','updated_at'}}

def wait(job):
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        current = api('/jobs/' + job['id'])
        if current['status'] not in ('queued','running','stopping'):
            assert current['status'] == 'completed', (current['status'], current['error'])
            return current
        time.sleep(3)
    raise RuntimeError('Acceptance task did not finish within 15 minutes; task retained')

assert api('/status')['llm_ready']
for path in ['/api/llm/config','/api/backend/llm/config','/api/backend/refresh','/api/studio/works']:
    try:
        urlopen(Request(base+path, data=b'{}', headers={'Content-Type':'application/json'}), timeout=20)
        raise AssertionError('Public admin guard failed')
    except HTTPError as e:
        assert e.code in (403,404,405)

world = api('/worlds', {'name':'上线验收世界', 'description':'小城旧书店', 'sections':{'world_rules':'时间只能向前，不能改变已经发生的事。'}})
report = []
for kind in ('short_drama','novel'):
    work = api('/works', {'title':f'上线验收·{kind}', 'content_type':kind, 'units':2, 'words_per_chapter':300,
                         'premise':'旧书店女孩发现一封写给明日的信。她寻找寄信者，与疏远的父亲解开误会，故事温暖、现实，无时间旅行。',
                         'world_id':world['id'], 'creative':{'genres':['都市'], 'styles':['温暖'], 'core':['父女和解']}})
    initial = api(f"/works/{work['id']}/jobs", {'action':'premise','revision':work['revision'], 'request_key':str(uuid.uuid4())})
    wait(initial)
    work = api('/jobs/' + initial['id'] + '/adopt', {})
    edited = payload(work)
    edited['premise'] += '\n编辑验收：保留温暖结局。'
    work = api('/works/' + work['id'], edited, 'PUT')
    assert api('/works/' + work['id'])['premise'].endswith('保留温暖结局。')
    job_input = {'mode':'all','revision':work['revision'],'request_key':str(uuid.uuid4())}
    all_job = api(f"/works/{work['id']}/jobs", job_input)
    duplicate = api(f"/works/{work['id']}/jobs", job_input)
    assert duplicate['id'] == all_job['id']
    finished = wait(all_job)
    assert finished['completed'] == finished['total'] == 5
    assert [r['number'] for r in finished['results'] if r['action']=='chapter'] == [1,2]
    assert not api('/works/' + work['id'])['chapters']
    work = api('/jobs/' + all_job['id'] + '/results/0/adopt', {})
    work = api('/jobs/' + all_job['id'] + '/adopt', {})
    assert len(work['chapters']) == 2
    text = api('/works/' + work['id'] + '/export')
    assert all(c['content'] in text for c in work['chapters'])
    backup = api('/works/' + work['id'] + '/backup')
    imported = api('/works/import', backup)
    assert imported['chapters'] == work['chapters'] and imported['id'] != work['id']
    # Retain all acceptance evidence, archived so it doesn't clutter real work.
    for item in (work, imported):
        saved = payload(item); saved['archived'] = True
        api('/works/' + item['id'], saved, 'PUT')
    report.append({'kind':kind, 'work_id':work['id'], 'job_id':all_job['id'], 'completed':finished['completed'],
                   'chapter_chars':[len(c['content']) for c in work['chapters']], 'export_and_backup':'passed'})
world['archived'] = True
api('/worlds/' + world['id'], {k:v for k,v in world.items() if k not in ('id','created_at','updated_at')}, 'PUT')
print(json.dumps({'ok':True,'results':report}, ensure_ascii=False))
