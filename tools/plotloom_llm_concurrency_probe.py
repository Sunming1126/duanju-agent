#!/usr/bin/env python3
"""Bounded, opt-in provider concurrency probe; never changes production settings."""
import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
from urllib.parse import urlsplit

import httpx


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--real-model', action='store_true', help='Explicitly authorize real billable API requests')
    parser.add_argument('--report-dir', type=Path, required=True, help='New private output directory; existing paths are refused')
    parser.add_argument('--max-concurrency', type=int, default=50, choices=range(1, 51), metavar='1..50')
    parser.add_argument('--round-interval', type=float, default=61, help='Minimum seconds from completion to the next stage (>=61)')
    parser.add_argument('--project-root', type=Path, default=Path(__file__).resolve().parent.parent, help='Read configuration from this existing project; never modify it')
    args = parser.parse_args()
    if args.round_interval < 61:
        parser.error('Keep at least 61 seconds between completed rounds to reduce RPM/TPM carryover')
    return args


def save(path, value):
    temporary = path.with_suffix('.pending')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
    os.replace(temporary, path)


def queue_busy(database):
    with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True) as db:
        return any(json.loads(row[0]).get('status') in {'queued', 'running', 'stopping'}
                   for table in ('studio_jobs', 'inspiration_jobs')
                   for row in db.execute('SELECT data FROM ' + table))


def safe_code(value):
    text = str(value or '')
    return text if re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', text) else 'unspecified'


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


async def probe(args, llm, database, report):
    path = args.report_dir / 'report.json'
    config = database.parent.parent / 'llm_config.json'
    config_hash = hashlib.sha256(config.read_bytes()).digest()
    headers = {'Authorization': 'Bearer ' + llm.API_KEY, 'Content-Type': 'application/json'}
    limits = httpx.Limits(max_connections=args.max_concurrency, max_keepalive_connections=args.max_concurrency)
    report['stop_reason'] = 'in_progress'
    save(path, report)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45, connect=10), limits=limits, follow_redirects=False) as client:
            for round_number, concurrency in enumerate(report['stages'], 1):
                if round_number > 1:
                    report['phase'] = 'cooldown'
                    save(path, report)
                    await asyncio.sleep(args.round_interval)
                if queue_busy(database):
                    report['stop_reason'] = 'production_queue_became_busy'
                    break
                report['phase'] = 'requests'
                report['current_round'] = round_number
                report['current_concurrency'] = concurrency
                save(path, report)
                active = peak = 0
                origin = time.perf_counter()
                async def one(index):
                    nonlocal active, peak
                    body = {'model': llm.MODEL, 'messages': [{'role': 'user', 'content': f'只回复大写英文字母OK，不要解释。连通性检查编号{round_number}-{index}。'}],
                            'temperature': 0, 'max_tokens': 32, 'thinking': {'type': 'disabled'}}
                    started = time.perf_counter()
                    active += 1
                    peak = max(peak, active)
                    result = {'request': index, 'start_offset_ms': round((started - origin) * 1000, 2)}
                    try:
                        response = await client.post(llm.API_BASE + '/chat/completions', headers=headers, json=body)
                        result['status'] = response.status_code
                        try:
                            data = response.json()
                        except ValueError:
                            data = {}
                        if response.status_code != 200:
                            error = data.get('error', {})
                            result.update(ok=False, error_code=safe_code(error.get('code') if isinstance(error, dict) else ''), kind='http_error')
                        else:
                            choice = (data.get('choices') or [{}])[0]
                            text = choice.get('message', {}).get('content')
                            usage = data.get('usage') or {}
                            result.update(ok=isinstance(text, str) and text.strip() == 'OK' and choice.get('finish_reason') == 'stop', finish_reason=safe_code(choice.get('finish_reason')),
                                          total_tokens=int(usage.get('total_tokens', 0)), completion_tokens=int(usage.get('completion_tokens', 0)),
                                          reasoning_tokens=int((usage.get('completion_tokens_details') or {}).get('reasoning_tokens', 0)))
                        # Record only numeric quota headers, never bodies, request IDs or credentials.
                        result['quota_headers'] = {key: value for key, value in response.headers.items()
                                                   if key in {'retry-after', 'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens'}
                                                   and re.fullmatch(r'[0-9.]+', value)}
                    except Exception as error:
                        result.update(ok=False, kind=type(error).__name__)
                    finally:
                        active -= 1
                        result['elapsed_s'] = round(time.perf_counter() - started, 3)
                    return result
                results = await asyncio.gather(*(one(index) for index in range(concurrency)))
                durations = [r['elapsed_s'] for r in results]
                summary = {'round': round_number, 'concurrency': concurrency, 'client_peak_inflight': peak,
                           'success': sum(r['ok'] for r in results), 'statuses': dict(Counter(str(r.get('status', 'transport_error')) for r in results)),
                           'error_codes': dict(Counter(r.get('error_code', r.get('kind', 'invalid_output')) for r in results if not r['ok'])),
                           'batch_elapsed_s': round(time.perf_counter() - origin, 3), 'p50_s': percentile(durations, .5), 'p95_s': percentile(durations, .95), 'max_s': max(durations),
                           'launch_spread_ms': max(r['start_offset_ms'] for r in results), 'total_tokens': sum(r.get('total_tokens', 0) for r in results)}
                report['rounds'].append(summary)
                report['requests_submitted'] += concurrency
                report['total_tokens_reported'] += summary['total_tokens']
                save(args.report_dir / f'round-{round_number}.json', results)
                save(path, report)
                print(json.dumps(summary), flush=True)
                if summary['success'] != concurrency:
                    report['stop_reason'] = 'first_unsuccessful_round_no_retry'
                    break
                if summary['p95_s'] > 15 or summary['max_s'] > 25:
                    report['stop_reason'] = 'latency_guard'
                    break
            else:
                report['stop_reason'] = 'bounded_ceiling_completed_not_absolute_provider_limit'
    finally:
        report['phase'] = 'finished'
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        report['production_config_unchanged'] = hashlib.sha256(config.read_bytes()).digest() == config_hash
        report['production_queue_busy_at_finish'] = queue_busy(database)
        save(path, report)


def main():
    args = arguments()
    stages = [n for n in (3, 5, 10, 20, 30, 50) if n <= args.max_concurrency]
    if args.max_concurrency not in stages:
        stages.append(args.max_concurrency)
    stages.append(args.max_concurrency)  # A fresh-window confirmation, only if earlier stages all succeed.
    report = {'stages': stages, 'maximum_requests_if_all_stages_pass': sum(stages), 'max_output_tokens_per_request': 32,
              'thinking': 'disabled_for_probe_only', 'retries': 0, 'round_interval_seconds': args.round_interval,
              'production_settings_changed': False, 'workload': 'tiny synthetic prompt; expected literal OK; not long-form generation'}
    if not args.real_model:
        print(json.dumps({'dry_run': True, **report}, ensure_ascii=False, indent=2))
        return
    root = args.project_root.resolve()
    sys.path.insert(0, str(root))
    from agent import llm
    llm._refresh_config()
    if urlsplit(llm.API_BASE).hostname != 'ark.cn-beijing.volces.com' or not llm.API_KEY:
        raise SystemExit('Expected the reviewed configured Ark API; no requests made')
    if not llm.MODEL.startswith(('deepseek-v4.1-flash', 'deepseek-v4-1-flash')):
        raise SystemExit('Probe thinking settings require the reviewed DeepSeek Flash model; no requests made')
    args.report_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    os.chmod(args.report_dir, 0o700)
    database = root / 'data/studio/studio.sqlite3'
    if queue_busy(database):
        raise SystemExit('Production queue is busy; no requests made')
    report.update(model=llm.MODEL, started_at=datetime.now(timezone.utc).isoformat(), requests_submitted=0, total_tokens_reported=0, rounds=[])
    asyncio.run(probe(args, llm, database, report))


if __name__ == '__main__':
    main()
