"""Run with python -m agent.studio_worker (one worker per SQLite file)."""
import asyncio
import os

from .studio_api import store
from .studio_jobs import JobStore, execute
from .studio_inspiration import InspirationStore, execute as execute_inspiration
from .studio_queue import MAX_CONCURRENT, next_job, records


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
    claimed = claim_next(jobs, inspirations)
    if not claimed:
        return False
    kind, job = claimed
    if kind == "inspiration":
        await execute_inspiration(inspirations, job)
    else:
        await execute(jobs, job)
    return True


def claim_next(jobs, inspirations):
    with jobs.store.transaction() as db:
        candidate = next_job(records(db))
    if not candidate:
        return None
    kind = "inspiration" if "session_id" in candidate else "work"
    job = (inspirations if kind == "inspiration" else jobs).claim(candidate["id"])
    return (kind, job) if job else None


async def run_claimed(jobs, inspirations, claimed):
    kind, job = claimed
    try:
        if kind == "inspiration":
            await execute_inspiration(inspirations, job)
        else:
            await execute(jobs, job, max_steps=1)
    except asyncio.CancelledError:
        raise
    except Exception:
        # One broken task must not stop the dispatcher or expose provider data.
        if kind == "inspiration":
            inspirations.finish(job["id"], error="执行失败，输入已保留，请主动重试。")
        else:
            jobs.finish_step(job["id"], error="执行失败，已完成部分保留，请主动继续。")


async def serve(jobs, inspirations):
    tasks = set()
    try:
        while True:
            while len(tasks) < MAX_CONCURRENT:
                claimed = claim_next(jobs, inspirations)
                if not claimed:
                    break
                tasks.add(asyncio.create_task(run_claimed(jobs, inspirations, claimed)))
            if not tasks:
                await asyncio.sleep(0.5)
                continue
            done, tasks = await asyncio.wait(tasks, timeout=0.5, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def run():
    jobs, inspirations = JobStore(store), InspirationStore(store)
    jobs.recover()
    inspirations.recover()
    await serve(jobs, inspirations)


if __name__ == '__main__':
    with lock_worker(store.path):
        asyncio.run(run())
