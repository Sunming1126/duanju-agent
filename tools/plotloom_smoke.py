"""HTTP verification for the public Chinese deployment (no credentials)."""
import json
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

base = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://127.0.0.1:3001'

def request(path, body=None):
    req = Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=20) as response:
        text = response.read().decode()
        return json.loads(text) if 'json' in response.headers.get('Content-Type', '') else text

assert 'Plotloom' in request('/')
status = request('/api/backend/studio/status')
assert status['llm_ready'] and status['model'] == 'deepseek-v4.1-flash'
for path in ['/api/backend/llm/config', '/api/llm/config', '/api/backend/refresh', '/api/backend/studio/../llm/config']:
    try:
        request(path, {})
        raise AssertionError('Unexpected public endpoint: ' + path)
    except HTTPError as exc:
        assert exc.code in (403, 404, 405), (path, exc.code)
work = request('/api/backend/studio/works', {'title': 'Plotloom 发布验收', 'content_type': 'novel', 'premise': '女孩在旧书中发现明日的来信。', 'units': 1})
candidate = request('/api/backend/studio/works/' + work['id'] + '/generate', {'action': 'premise', 'revision': work['revision']})
for _ in range(90):
    rows = request('/api/backend/studio/works/' + work['id'] + '/candidates')['items']
    current = next(row for row in rows if row['id'] == candidate['id'])
    if current['status'] != 'running':
        assert current['status'] == 'proposed', current.get('error')
        assert len(current['text']) > 30
        print(json.dumps({'ok': True, 'work_id': work['id'], 'candidate_chars': len(current['text']), 'public_guards': 'passed'}, ensure_ascii=False))
        break
    time.sleep(2)
else:
    raise RuntimeError('Generation timeout')
