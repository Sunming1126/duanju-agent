"""Run with python -m agent.studio_worker (one worker per SQLite file)."""
import asyncio
import os

from .studio_api import store
from .studio_jobs import JobStore, execute
from .studio_inspiration import InspirationStore, execute as execute_inspiration


def lock_worker(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(str(path) + '.worker.lock', 'a+b')
    if os.name == 'nt':
        import msvcrt
        handle.seek(0)
        handle.write(b'0')
        handle.flush()
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    return handle


async def run_once(jobs, inspirations):
    queued = [(j["created_at"], "work") for j in jobs.list() if j["status"] == "queued"]
    queued += [(j["created_at"], "inspiration") for j in inspirations.jobs() if j["status"] == "queued"]
    if not queued:
        return False
    if min(queued)[1] == "inspiration":
        job = inspirations.claim()
        if job:
            await execute_inspiration(inspirations, job)
    else:
        job = jobs.claim()
        if job:
            await execute(jobs, job)
    return bool(job)


async def run():
    jobs, inspirations = JobStore(store), InspirationStore(store)
    jobs.recover()
    inspirations.recover()
    while True:
        if not await run_once(jobs, inspirations):
            await asyncio.sleep(1)


if __name__ == '__main__':
    with lock_worker(store.path):
        asyncio.run(run())
