"""Shared request budget and fair, step-sized scheduling for the studio worker."""
from collections import Counter
from dataclasses import dataclass
import json
import math
import os

from fastapi import HTTPException
from .studio_identity import current_owner, owner

from .studio_store import now

MAX_CONCURRENT = 3
MAX_QUEUED = 10


@dataclass(frozen=True)
class QueuePolicy:
    concurrent: int
    queued: int
    owner_queued: int
    requests_per_minute: int


def policy():
    def number(key, fallback, low, high):
        try:
            value = int(os.environ.get(key, str(fallback)))
        except ValueError:
            raise ValueError(f"{key} must be an integer") from None
        if not low <= value <= high:
            raise ValueError(f"{key} must be between {low} and {high}")
        return value
    concurrent = number("PLOTLOOM_MAX_CONCURRENT", MAX_CONCURRENT, 1, 50)
    queued = number("PLOTLOOM_MAX_QUEUED", MAX_QUEUED, 1, 1000)
    return QueuePolicy(concurrent, queued,
                       number("PLOTLOOM_MAX_QUEUED_PER_OWNER", queued, 1, queued),
                       number("PLOTLOOM_REQUESTS_PER_MINUTE", 0, 0, 6000))


def capacity(db, owner_id=None):
    limits = policy()
    queued = [job for job in records(db) if job["status"] == "queued"]
    if len(queued) >= limits.queued:
        raise HTTPException(429, f"全站队列已满（最多{limits.queued}个排队任务），请稍后提交")
    if sum(owner(job) == (owner_id or current_owner()) for job in queued) >= limits.owner_queued:
        raise HTTPException(429, f"当前空间最多保留{limits.owner_queued}个排队任务，请等待已有任务完成")


def reserve_dispatch(db):
    # Called in the same IMMEDIATE transaction as claiming either task type.
    # This counts application dispatches, not provider-billed tokens or AFP.
    rpm = policy().requests_per_minute
    if not rpm:
        return True
    db.execute("CREATE TABLE IF NOT EXISTS studio_dispatches(id INTEGER PRIMARY KEY, started_at INTEGER NOT NULL)")
    moment = now()
    db.execute("DELETE FROM studio_dispatches WHERE started_at<=?", (moment - 60000,))
    if db.execute("SELECT count(*) FROM studio_dispatches").fetchone()[0] >= rpm:
        return False
    db.execute("INSERT INTO studio_dispatches(started_at) VALUES(?)", (moment,))
    return True


def records(db):
    result = []
    for table in ("studio_jobs", "inspiration_jobs"):
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            result.extend(json.loads(row[0]) for row in db.execute(f"SELECT data FROM {table}").fetchall())
    return result


def paused(db):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='studio_queue_state'").fetchone():
        return False
    row = db.execute("SELECT paused_until FROM studio_queue_state WHERE id=1").fetchone()
    return bool(row and row[0] > now())


def pause_after_rate_limit(store, error=None):
    error = error or {}
    with store.transaction() as db:
        db.execute("CREATE TABLE IF NOT EXISTS studio_queue_state(id INTEGER PRIMARY KEY, paused_until INTEGER NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS studio_throttle_state(id INTEGER PRIMARY KEY, streak INTEGER NOT NULL, last_at INTEGER NOT NULL)")
        moment = now()
        old = db.execute("SELECT streak,last_at FROM studio_throttle_state WHERE id=1").fetchone()
        streak = min(old[0] + 1, 6) if old and moment - old[1] < 300000 else 1
        delay = min(300, 30 * 2 ** (streak - 1))
        if error.get("limit_type") == "quota":
            delay = max(delay, 3600)
        try:
            upstream = float(error.get("retry_after_seconds", 0))
            if math.isfinite(upstream):
                delay = max(delay, min(86400, max(0, upstream)))
        except (ValueError, TypeError):
            pass
        until = moment + math.ceil(delay * 1000)
        db.execute("INSERT INTO studio_queue_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET paused_until=max(paused_until,excluded.paused_until)", (until,))
        db.execute("INSERT INTO studio_throttle_state VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET streak=excluded.streak,last_at=excluded.last_at", (streak, moment))


def queue_status(db):
    limits = policy()
    delay = 0
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='studio_queue_state'").fetchone():
        row = db.execute("SELECT paused_until FROM studio_queue_state WHERE id=1").fetchone()
        delay = max(0, math.ceil((row[0] - now()) / 1000)) if row else 0
    if limits.requests_per_minute and db.execute("SELECT 1 FROM sqlite_master WHERE name='studio_dispatches'").fetchone():
        row = db.execute("SELECT count(*),min(started_at) FROM studio_dispatches WHERE started_at>?", (now() - 60000,)).fetchone()
        if row[0] >= limits.requests_per_minute:
            delay = max(delay, math.ceil((row[1] + 60000 - now()) / 1000))
    return {"max_concurrent_requests": limits.concurrent, "max_queued_requests": limits.queued,
            "max_queued_per_space": limits.owner_queued, "dispatch_retry_after_seconds": delay}


def next_job(jobs):
    running = [job for job in jobs if job["status"] in {"running", "stopping"}]
    if len(running) >= policy().concurrent:
        return None
    waiting = [job for job in jobs if job["status"] == "queued"]
    if not waiting:
        return None
    owners = Counter(job.get("owner_id", "legacy") for job in running)
    served = {}
    for job in jobs:
        owner = job.get("owner_id", "legacy")
        served[owner] = max(served.get(owner, 0), job.get("dispatched_at", 0))
    return min(waiting, key=lambda job: (
        owners[job.get("owner_id", "legacy")],
        served.get(job.get("owner_id", "legacy"), 0),
        job.get("dispatched_at", job["created_at"]), job["created_at"], job["id"],
    ))
