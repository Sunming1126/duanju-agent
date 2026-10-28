#!/bin/bash
# Full source release. Called by deploy_plotloom.ps1 after archive verification.
set -euo pipefail
umask 027
archive=${1:?source archive required}
source_commit=${2:?source commit required}
[[ "$source_commit" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ "$archive" == /tmp/plotloom-*.zip && -f "$archive" ]] || exit 2
[[ $(id -u) == 0 ]] || { echo 'Run through sudo.' >&2; exit 2; }

base=/opt/plotloom-cn
services=(plotloom-cn-api plotloom-cn-worker plotloom-cn-web)
test -d "$base/backups" && test -L "$base/current"
exec 9>"$base/.deployment.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
old=$(readlink -f "$base/current")
case "$old" in "$base"/releases/*) ;; *) echo 'Unexpected current target; inspect before deployment.' >&2; exit 1 ;; esac
test -d "$old" && test -d "$base/shared/data"
python="$base/venv/bin/python"
test -x "$python" && test -x "$base/runtime/bin/node"
export PATH="$base/runtime/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
build_backend=http://127.0.0.1:8766
if [[ "${PLOTLOOM_REVIEW_ONLY:-0}" == 1 && -n "${PLOTLOOM_REVIEW_BACKEND_URL:-}" ]]; then
    test "$PLOTLOOM_REVIEW_BACKEND_URL" = http://127.0.0.1:8767 || { echo 'Review backend must use the dedicated loopback port 8767.' >&2; exit 2; }
    build_backend="$PLOTLOOM_REVIEW_BACKEND_URL"
fi
node -e 'if(Number(process.versions.node.split(".")[0])<24) process.exit(1)'
for service in "${services[@]}"; do
    systemctl is-active --quiet "$service"
    working_directory=$(systemctl show "$service" -p WorkingDirectory --value)
    resolved=$(readlink -f "$working_directory")
    case "$resolved" in "$old"|"$old"/*) ;; *) echo "Unexpected directory for $service; deployment stopped." >&2; exit 1 ;; esac
    test "$(systemctl show "$service" -p User --value)" = plotloom-cn
done
systemctl is-active --quiet duanju-agent
legacy_pid=$(systemctl show duanju-agent -p MainPID --value)
curl -fsS --max-time 10 http://127.0.0.1:8766/api/studio/status >/dev/null
curl -fsS --max-time 10 http://127.0.0.1:3001/ >/dev/null
db="$base/shared/data/studio/studio.sqlite3"
test -f "$db"
echo "Preflight confirmed current=$old; isolated api/web/worker active; Node $(node --version)."

stamp=$(date -u +%Y%m%dT%H%M%SZ)
release="$base/releases/$stamp-inspiration-${source_commit:0:8}"
backup="$base/backups/studio-$stamp-inspiration.sqlite3"
test ! -e "$release"
mkdir "$release"
downtime=0
switched=0

private_data_exists() {
    "$python" - "$db" <<'PY'
import json, sqlite3, sys
with sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True) as db:
    for table in ('works', 'worlds', 'studio_jobs', 'candidates', 'inspiration_sessions', 'inspiration_jobs'):
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            if any((json.loads(row[0]).get('owner_id') or 'legacy') != 'legacy' for row in db.execute('SELECT data FROM ' + table)):
                sys.exit(0)
sys.exit(1)
PY
}

rollback() {
    status=$?
    trap - ERR
    set +e
    echo "Deployment failed (exit $status); source=$source_commit." >&2
    if [[ "$downtime" == 1 ]]; then
        if [[ "$switched" == 1 ]]; then
            systemctl stop "${services[@]}"
            if [[ ! -f "$old/agent/studio_identity.py" ]] && private_data_exists; then
                echo 'Private records exist. Refusing to restore a pre-isolation program; services remain stopped for an operator fix. Shared data and new release are retained.' >&2
                exit "$status"
            fi
            ln -s "$old" "$base/current-rollback-$stamp"
            mv -Tf "$base/current-rollback-$stamp" "$base/current"
        fi
        systemctl start "${services[@]}"
        echo "Previous program target retained/restored: $(readlink -f "$base/current"). Shared data was not replaced." >&2
        systemctl is-active "${services[@]}" >&2
    else
        echo 'Live deployment unchanged.' >&2
    fi
    exit "$status"
}
trap rollback ERR

"$python" - "$archive" "$release" <<'PY'
import sys, zipfile
from pathlib import Path
target = Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as archive:
    for item in archive.infolist():
        name = Path(item.filename)
        if name.is_absolute() or '..' in name.parts or not (target / name).resolve().is_relative_to(target):
            raise ValueError('Unsafe archive path')
        if (item.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError('Archive symlinks are not supported')
    archive.extractall(target)
PY
test -f "$release/agent/studio_inspiration.py"
test -f "$release/agent/studio_writing.py"
test -f "$release/ai-website-cloner-template/src/components/studio/inspiration.tsx"
mv "$release/data" "$release/seed-data"
ln -s "$base/shared/data" "$release/data"
printf '%s\n' "$source_commit" > "$release/RELEASE_COMMIT"
mkdir "$release/.deploy-checks"
chown -hR plotloom-cn:plotloom-cn "$release"

# Import the new API in an isolated database and exercise routes without paid calls.
runuser -u plotloom-cn -- env DUANJU_STUDIO_DB="$release/.deploy-checks/studio.sqlite3" PYTHONPATH="$release" "$python" - <<'PY'
import asyncio, json, httpx
from studio_main import app
from agent.studio_api import WorkInput
from agent.studio_writing import validate_chapter_format
novel = WorkInput(title='deployment mode check', content_type='novel', mode='新建剧本')
assert novel.mode == '小说创作' and novel.novel_settings and not novel.drama_settings
async def check():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost') as client:
        response = await client.get('/api/studio/status')
        assert response.status_code == 200 and response.json()['llm_ready']
        assert response.json()['max_concurrent_requests'] == 3
        assert (await client.get('/api/studio/works')).status_code == 401
        assert (await client.get('/api/studio/session')).json()['isolated']
        assert (await client.get('/api/studio/worlds')).json()['items'] == []
        assert (await client.post('/api/studio/inspirations', json={})).status_code == 422
        response = await client.get('/api/studio/inspirations/deployment-check')
        assert response.status_code == 404 and response.json()['detail'] != 'Not Found'
asyncio.run(check())
print('Isolated backend import and inspiration route checks passed; no model calls.')
PY

cd "$release/ai-website-cloner-template"
runuser -u plotloom-cn -- env PATH="$PATH" npm ci --no-audit --no-fund
runuser -u plotloom-cn -- env PATH="$PATH" npm run lint
runuser -u plotloom-cn -- env PATH="$PATH" node --test scripts/samples.test.mjs scripts/workflow.test.mjs scripts/outline.test.mjs scripts/project.test.mjs
runuser -u plotloom-cn -- env PATH="$PATH" DUANJU_BACKEND_URL="$build_backend" NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1024 npm run build -- --webpack
grep -R -q 'inspiration-flow' .next/static/chunks
test "$(readlink -f "$base/current")" = "$old"

# Build a review candidate without changing current, services or the live database.
# Browser acceptance can use this directory before a normal approved release.
if [[ "${PLOTLOOM_REVIEW_ONLY:-0}" == 1 ]]; then
    trap - ERR
    echo "REVIEW_READY source=$source_commit release=$release current=$old"
    exit 0
fi

active_tasks() {
    "$python" - "$db" <<'PY'
import json, sqlite3, sys
with sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True) as db:
    count = 0
    for table in ('studio_jobs', 'inspiration_jobs'):
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            count += sum(json.loads(row[0])['status'] in ('queued','running','stopping') for row in db.execute('SELECT data FROM ' + table))
print(count)
PY
}
test "$(active_tasks)" = 0 || { echo 'Generation queue is busy. Live release unchanged; retry when tasks finish.' >&2; exit 1; }
printf '%s\n' "$old" > "$base/backups/previous-$stamp-inspiration.txt"
downtime=1
systemctl stop plotloom-cn-web plotloom-cn-api
# No public API can add new work now; finish a request that raced with the check.
for attempt in $(seq 1 50); do
    [[ "$(active_tasks)" == 0 ]] && break
    echo 'Waiting for the last generation task before switching...'
    sleep 5
done
test "$(active_tasks)" = 0
systemctl stop plotloom-cn-worker
"$python" - "$db" "$backup" <<'PY'
import sqlite3, sys
with sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True) as source, sqlite3.connect(sys.argv[2]) as target:
    source.backup(target)
    assert target.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
PY
chmod 600 "$backup"
if [[ ! -f "$base/shared/data/studio/legacy-claim-code.txt" ]]; then
    runuser -u plotloom-cn -- "$python" "$release/tools/studio_legacy_claim.py" --db "$db"
fi
ln -s "$release" "$base/current-next-$stamp"
mv -Tf "$base/current-next-$stamp" "$base/current"
switched=1
systemctl start "${services[@]}"
ready=0
for attempt in $(seq 1 45); do
    if curl -fsS --max-time 3 http://127.0.0.1:8766/api/studio/status >/dev/null 2>&1 && curl -fsS --max-time 3 http://127.0.0.1:3001/ >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
done
test "$ready" = 1

"$python" - "$archive" "$release" "$db" "$backup" <<'PY'
import hashlib, json, sqlite3, sys, zipfile
from pathlib import Path
from urllib.request import Request, urlopen as anonymous_open, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError
archive, release, database, backup = sys.argv[1:]
with zipfile.ZipFile(archive) as bundle:
    for entry in bundle.infolist():
        if entry.is_dir() or entry.filename.startswith('data/'):
            continue
        assert hashlib.sha256(bundle.read(entry)).digest() == hashlib.sha256((Path(release) / entry.filename).read_bytes()).digest(), entry.filename
with sqlite3.connect('file:' + backup + '?mode=ro', uri=True) as previous, sqlite3.connect('file:' + database + '?mode=ro', uri=True) as current:
    assert current.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    for table in ('works', 'worlds', 'studio_jobs', 'candidates'):
        if previous.execute("SELECT 1 FROM sqlite_master WHERE name=?", (table,)).fetchone():
            assert current.execute('SELECT count(*) FROM ' + table).fetchone()[0] >= previous.execute('SELECT count(*) FROM ' + table).fetchone()[0], table
for base in ('http://127.0.0.1:3001', 'https://jubencn.onesay.top'):
    opener = build_opener(HTTPCookieProcessor())
    urlopen = opener.open
    try:
        anonymous_open(base + '/api/backend/studio/works', timeout=30)
        raise AssertionError('Anonymous requests must not read private records')
    except HTTPError as error:
        assert error.code == 401
    with urlopen(base + '/api/backend/studio/session', timeout=30) as response:
        assert json.load(response)['isolated']
    for path in ('/works?view=summary', '/worlds', '/history'):
        with urlopen(base + '/api/backend/studio' + path, timeout=30) as response:
            assert json.load(response)['items'] == []
            assert 'no-store' in response.headers.get('Cache-Control', '')
    for path in ('/', '/concepts', '/workspace', '/worlds', '/studio/scripts/new', '/studio/novels/new', '/samples', '/samples?type=novel', '/samples?type=short_drama'):
        with urlopen(base + path, timeout=30) as response:
            assert response.status == 200
            if path.startswith('/samples'):
                listing = response.read().decode('utf-8')
                assert '先读一个好故事' not in listing and 'PLOTLOOM ORIGINALS' not in listing
                assert listing.count('class="sample-card ') == (10 if path == '/samples' else 5)
    for slug, kind in (('gate-name', 'novels'), ('door-card', 'novels'), ('temporary-parent', 'scripts'),
                       ('grain-scale', 'novels'), ('banquet-payroll', 'scripts'), ('night-watch', 'scripts'),
                       ('shop-sign', 'novels'), ('immortal-debt', 'scripts'), ('extra-seat', 'scripts'), ('floor-thirteen', 'novels')):
        with urlopen(base + '/samples/' + slug, timeout=30) as response:
            body = response.read().decode('utf-8')
            assert response.status == 200 and 'id="chapter-3"' in body and 'id="notes"' in body
        with urlopen(base + '/samples/' + slug + '/download', timeout=30) as response:
            document = response.read().decode('utf-8-sig')
            assert response.status == 200 and len(document) > 1000
            assert 'attachment;' in response.headers.get('Content-Disposition', '')
            assert 'charset=utf-8' in response.headers.get('Content-Type', '')
            assert 'AI辅助创作' in document and ('第3章' if kind == 'novels' else '第3集') in document
            assert '2026-10-27' in document and 'https://hongguoduanju.com/rank/hot-drama' in document
        with urlopen(base + '/studio/' + kind + '/new?sample=' + slug, timeout=30) as response:
            body = response.read().decode('utf-8')
            assert response.status == 200 and '我的版本' in body and '已载入官方样例设定' in body
    for path in ('/samples/not-a-sample/download', '/studio/novels/new?sample=temporary-parent', '/studio/scripts/new?sample=gate-name'):
        try:
            with urlopen(base + path, timeout=30) as response:
                body = response.read().decode('utf-8')
                # Next's loading boundary can stream a notFound() page as 200.
                assert '/download' not in path and 'NEXT_HTTP_ERROR_FALLBACK;404' in body
                assert '已载入官方样例设定' not in body, path
        except HTTPError as error:
            assert error.code == 404, (path, error.code)
    with urlopen(base + '/api/backend/studio/status', timeout=30) as response:
        assert json.load(response)['llm_ready']
    for path, payload, expected in (('/api/backend/studio/inspirations', b'{}', (422,)), ('/api/backend/llm/config', b'{}', (403,404,405)), ('/api/llm/config', b'{}', (403,404,405))):
        try:
            urlopen(Request(base + path, data=payload, headers={'Content-Type':'application/json'}), timeout=30)
            raise AssertionError('Unexpected route response: ' + path)
        except HTTPError as error:
            assert error.code in expected, (path, error.code)
with anonymous_open('https://juben.onesay.top', timeout=30) as response:
    assert response.status == 200
print('Source hashes, retained database records, official samples/downloads/drafts, public pages, inspiration proxy and admin boundaries passed.')
PY
for service in "${services[@]}"; do systemctl is-active --quiet "$service"; done
test "$(systemctl show duanju-agent -p MainPID --value)" = "$legacy_pid"
systemctl is-active --quiet duanju-agent
trap - ERR
echo "DEPLOYMENT_OK source=$source_commit release=$release previous=$old database_backup=$backup"
echo 'Chinese api/web/worker active; legacy process unchanged. No model generation calls made during deployment checks.'
