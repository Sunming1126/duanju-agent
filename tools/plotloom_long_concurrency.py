#!/usr/bin/env python3
"""Opt-in live 2000-character chapter test and bounded concurrency promotion."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import uuid

import httpx

STAGES = (5, 10, 10)
BASE = 'https://jubencn.onesay.top'
PREFIX = '/api/backend/studio'
ACTIVE = {'queued', 'running', 'stopping'}


def arguments():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--real-model', action='store_true')
    p.add_argument('--apply-concurrency', action='store_true')
    p.add_argument('--confirm-five', action='store_true', help='One independent five-request confirmation; never retry prior job IDs')
    p.add_argument('--project-root', type=Path, default=Path(__file__).resolve().parent.parent)
    p.add_argument('--report-dir', type=Path, required=True)
    args = p.parse_args()
    if args.real_model != args.apply_concurrency:
        p.error('Real execution requires both --real-model and --apply-concurrency')
    return args


def save(path, data):
    tmp = path.with_suffix('.pending')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(data, out, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def pending(database):
    with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True) as db:
        return [json.loads(row[0]) for t in ('studio_jobs', 'inspiration_jobs') for row in db.execute('SELECT data FROM ' + t) if json.loads(row[0]).get('status') in ACTIVE]


def chapter_input(case, stage, index):
    return {'title': f'并发验收-{stage}-{index}-{case["title"]}', 'content_type': 'novel', 'genre': '古代处境与人物成长',
            'mode': '小说创作', 'units': 2, 'words_per_chapter': 2000, 'audience': 'female',
            'market': 'china', 'output_locale': 'zh-CN', 'premise': case['premise'], 'characters': case['characters'], 'outline': case['outline'],
            'novel_settings': {'form': 'short_story', 'perspective': 'third_limited', 'prose_style': 'natural', 'pacing': 'balanced'}}


def main():
    args = arguments()
    stages = (5,) if args.confirm_five else STAGES
    if not args.real_model:
        print(json.dumps({'dry_run': True, 'stages': stages, 'maximum_paid_jobs': sum(stages), 'words_per_chapter': 2000,
                          'max_tokens': 12000, 'thinking': 'provider-default', 'retries': 0, 'production_cap_if_all_pass': stages[-1]}, ensure_ascii=False))
        return
    base = Path('/opt/plotloom-cn')
    root = args.project_root.resolve()
    if base not in root.parents or not (root / 'RELEASE_COMMIT').exists():
        raise SystemExit('Live mode requires the existing isolated Plotloom release')
    args.report_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    os.chmod(args.report_dir, 0o700)
    sys.path.insert(0, str(root))
    sys.path.insert(0, str(root / 'tools'))
    from dotenv import dotenv_values, set_key, unset_key
    from plotloom_novel_quality import CASES
    from agent.studio_api import WorkInput
    database = base / 'shared/data/studio/studio.sqlite3'
    config = base / 'shared/login.env'
    source = (root / 'RELEASE_COMMIT').read_text().strip()
    if pending(database):
        raise SystemExit('Production queue is busy; no changes or calls made')
    initial = dotenv_values(config)
    initial_cap = int(initial.get('PLOTLOOM_MAX_CONCURRENT') or 3)
    validated = initial_cap
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    config_backup = base / 'backups' / ('login-env-long-concurrency-' + timestamp)
    config_backup.write_bytes(config.read_bytes()); config_backup.chmod(0o600)
    db_backup = base / 'backups' / ('studio-long-concurrency-' + timestamp + '.sqlite3')
    with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True) as db, sqlite3.connect(db_backup) as backup:
        db.backup(backup)
    db_backup.chmod(0o600)
    model_hash = hashlib.sha256((base / 'shared/data/llm_config.json').read_bytes()).hexdigest()
    def service_pids():
        return {name: subprocess.check_output(['systemctl', 'show', name, '--property=MainPID', '--value'], text=True).strip()
                for name in ['plotloom-cn-api', 'plotloom-cn-worker', 'plotloom-cn-web', 'duanju-agent']}
    before_pids = service_pids()
    report = {'source': source, 'started_at': datetime.now(timezone.utc).isoformat(), 'phase': 'prepared', 'ok': False,
              'stages': list(stages), 'maximum_paid_jobs': sum(stages), 'submitted_jobs': 0, 'rounds': [], 'spaces': [],
              'all_qa_works': [], 'all_qa_jobs': [], 'config_backup': str(config_backup), 'database_backup': str(db_backup),
              'initial_concurrency': initial_cap, 'validated_concurrency': validated, 'parameters': {'words_per_chapter': 2000, 'max_tokens': 12000, 'thinking': 'provider-default', 'temperature': .8}}
    report_path = args.report_dir / 'report.json'
    def record(): save(report_path, report)
    record()
    clients = [httpx.Client(base_url=BASE, timeout=45, headers={'Origin': BASE}, follow_redirects=False) for _ in range(3)]
    def api(client, method, path, payload=None):
        response = client.request(method, PREFIX + path, json=payload)
        if not response.is_success:
            raise RuntimeError(f'HTTP {response.status_code} at {path.split("?")[0]}')
        return response.json()
    def drain(seconds=300):
        deadline = time.monotonic() + seconds
        while pending(database):
            if time.monotonic() > deadline:
                raise RuntimeError('Active jobs retained; no cancellation or repeated request')
            time.sleep(1)
    def configure(value):
        if (base / 'current').resolve() != root:
            raise RuntimeError('Release changed during test; stop before config changes')
        drain()
        # Block new submissions, then drain any request that raced the first check.
        subprocess.run(['systemctl', 'stop', 'plotloom-cn-api'], check=True)
        try:
            drain()
            subprocess.run(['systemctl', 'stop', 'plotloom-cn-worker'], check=True)
            stat = config.stat(); tmp = config.with_name('login.env.long-pending')
            tmp.write_bytes(config.read_bytes()); tmp.chmod(0o600)
            if value == initial_cap and 'PLOTLOOM_MAX_CONCURRENT' not in initial:
                unset_key(tmp, 'PLOTLOOM_MAX_CONCURRENT')
            else:
                set_key(tmp, 'PLOTLOOM_MAX_CONCURRENT', str(value), quote_mode='always')
            settings = dotenv_values(tmp)
            assert all(settings.get(k) == v for k, v in initial.items() if k != 'PLOTLOOM_MAX_CONCURRENT')
            os.chown(tmp, stat.st_uid, stat.st_gid); os.chmod(tmp, 0o600); os.replace(tmp, config)
        finally:
            subprocess.run(['systemctl', 'start', 'plotloom-cn-worker', 'plotloom-cn-api'], check=True)
        deadline = time.monotonic() + 30
        while True:
            try:
                status = clients[0].get(PREFIX + '/status').json()
                if status['max_concurrent_requests'] == value: break
            except Exception: pass
            if time.monotonic() > deadline: raise RuntimeError('Updated API policy not confirmed')
            time.sleep(.5)
        report['effective_concurrency'] = value; record()
    try:
        for c in clients:
            space = api(c, 'GET', '/session')
            report['spaces'].append(space['space_id'])
            c.headers['X-Plotloom-Space'] = space['space_id']
        record()
        for round_index, concurrency in enumerate(stages, 1):
            if round_index > 1:
                report['phase'] = 'cooldown'; record(); time.sleep(61)
            if pending(database):
                report['stop_reason'] = 'production_queue_became_busy'; break
            if report.get('effective_concurrency') != concurrency:
                configure(concurrency)
            report['phase'] = 'submitting'; report['current_round'] = round_index; record()
            works = []; jobs = []
            for i in range(concurrency):
                c = clients[i % len(clients)]; case = CASES[i % len(CASES)]
                body = WorkInput.model_validate(chapter_input(case, round_index, i)).model_dump()
                work = api(c, 'POST', '/works', body)
                entry = {'id': work['id'], 'client': i % len(clients), 'revision': work['revision']}
                works.append(entry); report['all_qa_works'].append(entry); record()
            for i, work in enumerate(works):
                key = str(uuid.uuid4())
                # The pending key is recorded before sending; an uncertain response is not retried.
                report['last_submission'] = {'work_id': work['id'], 'request_key': key, 'confirmed': False}; record()
                job = api(clients[work['client']], 'POST', f'/works/{work["id"]}/jobs', {'revision': work['revision'], 'request_key': key, 'action': 'chapter', 'number': 1})
                entry = {'id': job['id'], 'work_id': work['id'], 'client': work['client']}
                jobs.append(entry); report['all_qa_jobs'].append(entry); report['submitted_jobs'] += 1
                report['last_submission']['confirmed'] = True; record()
            report['phase'] = 'generating'; record()
            peak = 0; deadline = time.monotonic() + 280; statuses = {}
            while True:
                with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True) as db:
                    rows = {job['id']: json.loads(db.execute('SELECT data FROM studio_jobs WHERE id=?', (job['id'],)).fetchone()[0]) for job in jobs}
                statuses = {key: row['status'] for key, row in rows.items()}
                peak = max(peak, sum(state in {'running', 'stopping'} for state in statuses.values()))
                report['progress'] = {'total': concurrency, 'completed': sum(state == 'completed' for state in statuses.values()), 'failed': sum(state in {'failed', 'interrupted', 'stopped'} for state in statuses.values()), 'peak_running': peak}; record()
                if not any(state in ACTIVE for state in statuses.values()): break
                if time.monotonic() > deadline: raise RuntimeError('Batch unresolved; recorded job IDs retained, no retry')
                time.sleep(.5)
            items = []
            for job in jobs:
                result = api(clients[job['client']], 'GET', '/jobs/' + job['id'])
                save(args.report_dir / (job['id'] + '.json'), result)
                body = (result.get('results') or [{}])[0]
                text = body.get('text', ''); summary = body.get('summary', '')
                timing = rows[job['id']]
                duration = (timing['updated_at'] - timing.get('dispatched_at', timing['created_at'])) / 1000
                passed = result['status'] == 'completed' and len(text) >= 1500 and 1 <= len(summary) <= 400
                adopted = False
                if passed:
                    api(clients[job['client']], 'POST', '/jobs/' + job['id'] + '/adopt', {})
                    read = api(clients[job['client']], 'GET', '/works/' + job['work_id'])
                    assert read['chapters'][0]['content'] == text
                    adopted = True
                items.append({'job_id': job['id'], 'status': result['status'], 'text_characters': len(text), 'summary_characters': len(summary), 'elapsed_s': round(duration, 3), 'passed': passed, 'adopted_and_reread': adopted})
            durations = sorted(item['elapsed_s'] for item in items)
            summary = {'round': round_index, 'concurrency': concurrency, 'peak_running_observed': peak, 'completed': sum(item['status'] == 'completed' for item in items), 'passed': sum(item['passed'] for item in items), 'min_characters': min(item['text_characters'] for item in items), 'max_characters': max(item['text_characters'] for item in items), 'p50_s': durations[(len(durations)-1)//2], 'max_s': durations[-1], 'items': items}
            report['rounds'].append(summary); record(); print(json.dumps(summary, ensure_ascii=False), flush=True)
            if summary['passed'] != concurrency or peak < concurrency or durations[-1] > 180:
                report['stop_reason'] = 'first_failed_format_overlap_length_or_latency_check_no_retry'; break
            if concurrency == 5 or round_index == len(stages):
                validated = concurrency; report['validated_concurrency'] = validated; record()
        else:
            report['ok'] = True; report['stop_reason'] = 'all_planned_rounds_passed'
    except Exception as error:
        report['error_type'] = type(error).__name__
        report['stop_reason'] = 'exception_no_automatic_resubmission'
    finally:
        try:
            drain()
            if report.get('effective_concurrency') != validated:
                configure(validated)
            report['validated_concurrency'] = validated
            # Delete only exact QA works in the same caller spaces. Exported results remain private.
            for work in report['all_qa_works']:
                c = clients[work['client']]
                value = api(c, 'GET', '/works/' + work['id'])
                api(c, 'DELETE', f'/works/{work["id"]}?revision={value["revision"]}')
            report['qa_works_cleaned'] = True
        except Exception as error:
            report['cleanup_error_type'] = type(error).__name__
        report['phase'] = 'finished'; report['finished_at'] = datetime.now(timezone.utc).isoformat()
        report['model_configuration_unchanged'] = hashlib.sha256((base / 'shared/data/llm_config.json').read_bytes()).hexdigest() == model_hash
        report['services_before'] = before_pids; report['services_after'] = service_pids()
        record()
        for c in clients: c.close()
        print(json.dumps({key: report.get(key) for key in ['ok', 'stop_reason', 'submitted_jobs', 'validated_concurrency', 'qa_works_cleaned', 'cleanup_error_type', 'model_configuration_unchanged']}, ensure_ascii=False), flush=True)


if __name__ == '__main__': main()
