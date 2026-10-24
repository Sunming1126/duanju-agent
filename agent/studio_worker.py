"""Run with python -m agent.studio_worker (one worker per SQLite file)."""
import asyncio
import os

from .studio_api import store
from .studio_jobs import JobStore, execute


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


async def run():
    jobs = JobStore(store)
    jobs.recover()
    while True:
        job = jobs.claim()
        if job:
            await execute(jobs, job)
        else:
            await asyncio.sleep(1)


if __name__ == '__main__':
    with lock_worker(store.path):
        asyncio.run(run())
