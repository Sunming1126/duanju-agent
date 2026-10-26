"""Local Chinese creative workspace. Worlds and works have distinct owners.

An isolated SQLite file holds drafts, immutable generation inputs and candidates.
Model output cannot change manuscripts until an explicit, revision-checked adopt.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parent.parent
WORLD_SECTIONS = json.loads((ROOT / "third_party/storyforge/world-sections.json").read_text(encoding="utf-8"))
WORLD_FIELDS = {field["key"] for section in WORLD_SECTIONS for field in section["fields"]}


def now():
    return int(time.time() * 1000)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def world_payload(world):
    return {"name": world["name"], "description": world["description"], "sections": world["sections"]}


class StudioStore:
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get("DUANJU_STUDIO_DB") or ROOT / "data/studio/studio.sqlite3")

    @contextmanager
    def transaction(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), data TEXT NOT NULL)")
            connection.execute("BEGIN IMMEDIATE")
            # One-time additive migration. Old linked worlds become private snapshots.
            if connection.execute("PRAGMA user_version").fetchone()[0] < 1:
                for row in connection.execute("SELECT data FROM works").fetchall():
                    work = json.loads(row["data"])
                    if "world_snapshot" not in work:
                        linked = connection.execute("SELECT data FROM worlds WHERE id=?", (work.get("world_id"),)).fetchone()
                        work["world_snapshot"] = world_payload(json.loads(linked["data"])) if linked else None
                    work.setdefault("creative", {})
                    work.setdefault("archived", False)
                    self.write(connection, "works", work)
                connection.execute("PRAGMA user_version=1")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def read(db, table, ident):
        if table not in {"worlds", "works", "candidates"}:
            raise ValueError("unknown record type")
        row = db.execute(f"SELECT data FROM {table} WHERE id=?", (ident,)).fetchone()
        if not row:
            raise HTTPException(404, "记录不存在")
        return json.loads(row["data"])

    @staticmethod
    def write(db, table, record):
        if table not in {"worlds", "works", "candidates"}:
            raise ValueError("unknown record type")
        if table == "candidates":
            db.execute("INSERT INTO candidates(id,work_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                       (record["id"], record["work_id"], json.dumps(record, ensure_ascii=False)))
        else:
            db.execute(f"INSERT INTO {table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                       (record["id"], json.dumps(record, ensure_ascii=False)))

    def list(self, table, work_id=None):
        if table not in {"worlds", "works", "candidates"}:
            raise ValueError("unknown record type")
        with self.transaction() as db:
            if table == "candidates":
                rows = db.execute("SELECT data FROM candidates WHERE work_id=?", (work_id,)).fetchall()
            else:
                rows = db.execute(f"SELECT data FROM {table}").fetchall()
        return sorted((json.loads(row["data"]) for row in rows), key=lambda record: record["updated_at"], reverse=True)

    def get(self, table, ident):
        with self.transaction() as db:
            return self.read(db, table, ident)

    def create_world(self, data):
        record = {**data, "id": str(uuid.uuid4()), "revision": 1, "created_at": now(), "updated_at": now()}
        with self.transaction() as db:
            self.write(db, "worlds", record)
        return record

    def update_world(self, ident, data, revision):
        with self.transaction() as db:
            old = self.read(db, "worlds", ident)
            if old["revision"] != revision:
                raise HTTPException(409, "世界已在其他窗口更新，请重新加载后保存")
            updated = {**old, **data, "revision": revision + 1, "updated_at": now()}
            self.write(db, "worlds", updated)
        return updated

    def create_work(self, data):
        with self.transaction() as db:
            if data.get("world_id"):
                data["world_snapshot"] = world_payload(self.read(db, "worlds", data["world_id"]))
            # Idempotent browser-draft migration; keep original data in browser.
            legacy_id = data.get("legacy_id")
            if legacy_id:
                for row in db.execute("SELECT data FROM works").fetchall():
                    existing = json.loads(row["data"])
                    if existing.get("legacy_id") == legacy_id:
                        return existing
            record = {**data, "id": str(uuid.uuid4()), "revision": 1, "created_at": now(), "updated_at": now()}
            self.write(db, "works", record)
        return record

    def update_work(self, ident, data, revision):
        with self.transaction() as db:
            old = self.read(db, "works", ident)
            if old["revision"] != revision:
                raise HTTPException(409, "作品已更新，请先重新加载；当前编辑内容可导出备份")
            if data.get("content_type", old["content_type"]) != old["content_type"]:
                raise HTTPException(409, "已创建作品的类型不能更改，请从对应入口创建新作品")
            if data.get("world_id") and data.get("world_id") != old.get("world_id"):
                data["world_snapshot"] = world_payload(self.read(db, "worlds", data["world_id"]))
            updated = {**old, **data, "revision": revision + 1, "updated_at": now()}
            self.write(db, "works", updated)
        return updated

    def begin_candidate(self, work_id, action, number, revision):
        with self.transaction() as db:
            work = self.read(db, "works", work_id)
            if work["revision"] != revision:
                raise HTTPException(409, "请先重新加载作品，再启动生成")
            if number > work["units"]:
                raise HTTPException(422, "所选集／章超出计划数量")
            for row in db.execute("SELECT data FROM candidates WHERE work_id=?", (work_id,)).fetchall():
                if json.loads(row["data"])["status"] == "running":
                    raise HTTPException(409, "已有生成任务进行中，请等待完成")
            world = work.get("world_snapshot")
            record = {"id": str(uuid.uuid4()), "work_id": work_id, "action": action, "number": number,
                      "base_revision": revision, "status": "running", "text": "", "error": "",
                      "work_snapshot": work, "world_snapshot": world, "references": [],
                      "created_at": now(), "updated_at": now()}
            self.write(db, "candidates", record)
        return record

    def complete_candidate(self, ident, text="", error="", references=None):
        with self.transaction() as db:
            record = self.read(db, "candidates", ident)
            if record["status"] != "running":
                return record
            record.update(text=text, error=error, status="failed" if error or not text.strip() else "proposed", updated_at=now())
            record["references"] = references or []
            self.write(db, "candidates", record)
        return record

    def adopt(self, work_id, candidate_id):
        with self.transaction() as db:
            work = self.read(db, "works", work_id)
            candidate = self.read(db, "candidates", candidate_id)
            if candidate["work_id"] != work_id:
                raise HTTPException(404, "候选不存在")
            if candidate["status"] == "adopted":
                return work
            if candidate["status"] != "proposed":
                raise HTTPException(409, "候选未完成或已失效，不能采纳")
            if work["revision"] != candidate["base_revision"]:
                raise HTTPException(409, "候选基于旧稿生成，请保留候选文本，重新生成后再采纳")
            snapshot = candidate.get("world_snapshot")
            if snapshot and work.get("world_snapshot") and canonical(world_payload(snapshot)) != canonical(world_payload(work["world_snapshot"])):
                raise HTTPException(409, "作品世界已变化，旧候选不能覆盖当前稿；候选仍可查看和导出")
            if snapshot and not work.get("world_snapshot") and "id" in snapshot and self.read(db, "worlds", snapshot["id"])["revision"] != snapshot["revision"]:
                raise HTTPException(409, "世界设定已变化，请核对新设定后重新生成；候选仍保留")
            if candidate["action"] == "chapter":
                number = candidate["number"]
                chapters = [chapter for chapter in work["chapters"] if chapter["number"] != number]
                chapters.append({"number": number, "title": f"第{number}{'章' if work['content_type'] == 'novel' else '集'}",
                                 "content": candidate["text"]})
                work["chapters"] = sorted(chapters, key=lambda chapter: chapter["number"])
            else:
                work[candidate["action"]] = candidate["text"]
            work.update(revision=work["revision"] + 1, updated_at=now())
            candidate.update(status="adopted", updated_at=now())
            self.write(db, "works", work)
            self.write(db, "candidates", candidate)
        return work

    def recover_interrupted(self):
        with self.transaction() as db:
            for row in db.execute("SELECT data FROM candidates").fetchall():
                record = json.loads(row["data"])
                if record["status"] == "running":
                    record.update(status="failed", error="服务重启中断了生成，请核对后手动重试；不会自动重复请求模型。", updated_at=now())
                    self.write(db, "candidates", record)

    def export_world(self, ident):
        world = self.get("worlds", ident)
        payload = {"schema": "onesay.world-draft", "version": 1, "world": world_payload(world)}
        return {**payload, "checksum": hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()}


def export_work_text(work):
    unit = "章" if work["content_type"] == "novel" else "集"
    parts = [work["title"], f"{'小说' if unit == '章' else '短剧'} · {work['genre']} · 计划{work['units']}{unit}",
             "\n故事设定\n" + work["premise"], "\n人物小传\n" + work["characters"], "\n大纲\n" + work["outline"]]
    if work.get("creative"):
        parts.append("\n创作参数\n" + json.dumps(work["creative"], ensure_ascii=False, indent=2))
    if work.get("world_snapshot"):
        parts.append("\n作品世界副本\n" + json.dumps(work["world_snapshot"], ensure_ascii=False, indent=2))
    parts.extend(f"\n第{chapter['number']}{unit} {chapter['title']}\n{chapter['content']}" for chapter in sorted(work["chapters"], key=lambda chapter: chapter["number"]))
    return "\n".join(parts)
