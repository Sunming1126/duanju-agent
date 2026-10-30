"""Opaque browser sessions and record ownership; credentials never enter JSON APIs."""
from contextvars import ContextVar
import hashlib
import json
import os
import re
import secrets
import time
import uuid
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse

actor = ContextVar("studio_owner", default=None)
COOKIE = "plotloom_space"
AUTH_COOKIE = "plotloom_account"
LEGACY = "legacy"


class StudioJSONResponse(JSONResponse):
    def render(self, content):
        def public(value):
            if isinstance(value, dict):
                return {key: public(item) for key, item in value.items() if key != "owner_id"}
            if isinstance(value, list):
                return [public(item) for item in value]
            return value
        return super().render(public(content))


def owner(record):
    return record.get("owner_id") or LEGACY


def current_owner():
    return actor.get() or LEGACY


def visible(record):
    return actor.get() is None or owner(record) == actor.get()


def authorize(record):
    if not visible(record):
        raise HTTPException(404, "记录不存在")
    return record


def request_key(key, owner_id=None):
    identity = owner_id or current_owner()
    return key if identity == LEGACY else identity + ":" + key


class SpaceStore:
    def __init__(self, store):
        self.store = store

    @staticmethod
    def schema(db):
        db.execute("CREATE TABLE IF NOT EXISTS studio_spaces(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, legacy_access INTEGER NOT NULL DEFAULT 0)")
        db.execute("CREATE TABLE IF NOT EXISTS studio_identity_state(name TEXT PRIMARY KEY, value TEXT NOT NULL)")

    def resolve(self, token):
        if not token or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return None
        with self.store.transaction() as db:
            self.schema(db)
            # Once claimed by an account, the old guest token must lose access.
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='studio_accounts'").fetchone():
                linked = db.execute("SELECT 1 FROM studio_accounts a JOIN studio_spaces s ON a.space_id=s.id WHERE s.token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
                if linked:
                    return None
            row = db.execute("SELECT id, legacy_access FROM studio_spaces WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
            return dict(row) if row else None

    def create(self):
        token = secrets.token_urlsafe(32)
        identity = str(uuid.uuid4())
        with self.store.transaction() as db:
            self.schema(db)
            db.execute("INSERT INTO studio_spaces(id,token_hash,created_at) VALUES(?,?,?)", (identity, hashlib.sha256(token.encode()).hexdigest(), int(time.time() * 1000)))
        return {"id": identity, "legacy_access": False}, token

    def legacy_allowed(self):
        with self.store.transaction() as db:
            self.schema(db)
            row = db.execute("SELECT legacy_access FROM studio_spaces WHERE id=?", (current_owner(),)).fetchone()
            return bool(row and row[0])

    def prepare_legacy_claim(self, code):
        # Called only by the server operator's CLI, never by an anonymous route.
        with self.store.transaction() as db:
            self.schema(db)
            db.execute("INSERT INTO studio_identity_state VALUES('legacy_claim_hash',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value", (hashlib.sha256(code.encode()).hexdigest(),))

    def claim_legacy(self, code):
        with self.store.transaction() as db:
            self.schema(db)
            row = db.execute("SELECT value FROM studio_identity_state WHERE name='legacy_claim_hash'").fetchone()
            digest = hashlib.sha256(code.encode()).hexdigest()
            if not row or not secrets.compare_digest(row[0], digest):
                raise HTTPException(403, "恢复码无效或已使用，请联系维护者")
            identity = current_owner()
            if identity == LEGACY or not db.execute("SELECT 1 FROM studio_spaces WHERE id=?", (identity,)).fetchone():
                raise HTTPException(401, "请先建立独立创作空间")
            counts = {}
            for table in ("works", "worlds", "candidates", "studio_jobs", "inspiration_sessions", "inspiration_jobs"):
                if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                    continue
                count = 0
                for item in db.execute(f"SELECT id,data FROM {table}").fetchall():
                    record = json.loads(item["data"])
                    if owner(record) != LEGACY:
                        continue
                    record["owner_id"] = identity
                    if table in {"studio_jobs", "inspiration_jobs"}:
                        db.execute(f"UPDATE {table} SET data=?,request_key=? WHERE id=?", (json.dumps(record, ensure_ascii=False), request_key(record["request_key"], identity), item["id"]))
                    else:
                        db.execute(f"UPDATE {table} SET data=? WHERE id=?", (json.dumps(record, ensure_ascii=False), item["id"]))
                    count += 1
                counts[table] = count
            db.execute("UPDATE studio_spaces SET legacy_access=1 WHERE id=?", (identity,))
            db.execute("DELETE FROM studio_identity_state WHERE name='legacy_claim_hash'")
            return counts


def service():
    from .studio_api import store
    return SpaceStore(store)


def session(request: Request, response: Response):
    spaces = service()
    identity = request_identity(request)
    if not identity:
        identity, token = spaces.create()
        secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
        response.set_cookie(COOKIE, token, max_age=31536000, httponly=True, secure=secure, samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store, private"
    return {"space_id": identity["id"], "isolated": True, "legacy_access": bool(identity["legacy_access"]), "user": identity.get("user")}


def request_identity(request):
    from .studio_auth import auth_service
    return auth_service().resolve(request.cookies.get(AUTH_COOKIE)) or service().resolve(request.cookies.get(COOKIE))


async def require_identity(request: Request):
    path = request.url.path
    if path in {"/api/studio/status", "/api/studio/session"} or path.startswith("/api/studio/references"):
        yield
        return
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        hosts = {request.headers.get("host", "").lower()}
        # Uvicorn can replace client.host with the browser IP from proxy headers.
        # Keep the configured public origin valid even when upstream Host is local.
        public_origin = os.environ.get("PLOTLOOM_PUBLIC_ORIGIN", "https://jubencn.onesay.top")
        hosts.add(urlsplit(public_origin).netloc.lower())
        if request.client and request.client.host in {"127.0.0.1", "::1"}:
            hosts.add(request.headers.get("x-forwarded-host", "").split(",")[0].strip().lower())
        try:
            origin_host = urlsplit(origin).netloc.lower() if origin else None
        except ValueError:
            raise HTTPException(403, "请在本网站内操作创作空间") from None
        if request.headers.get("sec-fetch-site") == "cross-site" or (origin and origin_host not in hosts):
            raise HTTPException(403, "请在本网站内操作创作空间")
    identity = request_identity(request)
    if not identity:
        raise HTTPException(401, "独立创作空间尚未建立或已失效，请刷新页面")
    expected_space = request.headers.get("x-plotloom-space")
    if expected_space and expected_space != identity["id"]:
        raise HTTPException(409, "登录账号或空间已在其他页面切换，请先备份未保存内容并刷新页面")
    token = actor.set(identity["id"])
    try:
        yield
    finally:
        actor.reset(token)


async def private_responses(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/studio/"):
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Vary"] = "Cookie"
    return response
