"""Shared request budget and fair, step-sized scheduling for the studio worker."""
from collections import Counter
import json

from .studio_store import now

MAX_CONCURRENT = 3
MAX_QUEUED = 10


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


def pause_after_rate_limit(store):
    # A provider rejection must not turn the waiting queue into a burst of 429s.
    with store.transaction() as db:
        db.execute("CREATE TABLE IF NOT EXISTS studio_queue_state(id INTEGER PRIMARY KEY, paused_until INTEGER NOT NULL)")
        db.execute("INSERT INTO studio_queue_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET paused_until=max(paused_until,excluded.paused_until)", (now() + 30000,))


def next_job(jobs):
    running = [job for job in jobs if job["status"] in {"running", "stopping"}]
    if len(running) >= MAX_CONCURRENT:
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
