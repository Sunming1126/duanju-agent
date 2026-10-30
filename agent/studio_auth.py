"""Plotloom-local email OTP and verified Google identities, independent of ChatChat data."""
import hashlib
import hmac
import os
import re
import secrets
import smtplib
import ssl
import time
import uuid
from email.message import EmailMessage

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .studio_identity import AUTH_COOKIE, COOKIE, SpaceStore, current_owner

SESSION_TTL = 30 * 86400


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def email_key(value):
    value = value.strip().lower()
    if len(value) > 254 or not re.fullmatch(r"[^\s@<>\x00-\x1f]+@[^\s@<>\x00-\x1f]+\.[^\s@<>\x00-\x1f]+", value):
        raise ValueError("请输入有效的邮箱地址")
    return value


def smtp_ready():
    return all(os.environ.get("PLOTLOOM_SMTP_" + key) for key in ("HOST", "USER", "PASSWORD", "FROM"))


def send_email(email, code):
    if not smtp_ready():
        raise HTTPException(503, "邮箱登录尚未配置，请联系维护者")
    message = EmailMessage()
    message["Subject"] = "Plotloom 登录验证码"
    message["From"] = os.environ["PLOTLOOM_SMTP_FROM"]
    message["To"] = email
    message.set_content(f"你的 Plotloom 登录验证码是：{code}\n\n10 分钟内有效，请勿转发。若非本人操作，请忽略这封邮件。")
    host = os.environ["PLOTLOOM_SMTP_HOST"]
    port = int(os.environ.get("PLOTLOOM_SMTP_PORT", "465"))
    context = ssl.create_default_context()
    # Both implicit TLS and mandatory STARTTLS are supported; never plaintext auth.
    transport = smtplib.SMTP_SSL(host, port, timeout=15, context=context) if port == 465 else smtplib.SMTP(host, port, timeout=15)
    with transport as smtp:
        if port != 465:
            smtp.starttls(context=context)
        smtp.login(os.environ["PLOTLOOM_SMTP_USER"], os.environ["PLOTLOOM_SMTP_PASSWORD"])
        smtp.send_message(message)


def verify_google(credential):
    client_id = os.environ.get("PLOTLOOM_GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(503, "Google 登录尚未配置，请联系维护者")
    try:
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2 import id_token
        # The official library checks signature, issuer, audience and expiry.
        class TimedRequest(GoogleRequest):
            def __call__(self, *args, **kwargs):
                kwargs["timeout"] = 10
                return super().__call__(*args, **kwargs)
        return id_token.verify_oauth2_token(credential, TimedRequest(), client_id)
    except ImportError:
        raise HTTPException(503, "Google 登录依赖尚未安装") from None
    except Exception:
        raise HTTPException(401, "Google 登录凭证无效或已过期，请重新登录") from None


class AuthStore:
    def __init__(self, store):
        self.store = store

    @staticmethod
    def schema(db):
        SpaceStore.schema(db)
        db.execute("CREATE TABLE IF NOT EXISTS studio_accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,google_sub TEXT UNIQUE,space_id TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS studio_account_avatars(account_id TEXT PRIMARY KEY REFERENCES studio_accounts(id) ON DELETE CASCADE,image BLOB NOT NULL,version TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS studio_auth_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES studio_accounts(id),expires_at INTEGER NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS studio_email_codes(email TEXT PRIMARY KEY,code_hash TEXT NOT NULL,sent_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,ready INTEGER NOT NULL DEFAULT 0,space_id TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS studio_auth_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS studio_google_nonces(space_id TEXT PRIMARY KEY,nonce_hash TEXT NOT NULL,expires_at INTEGER NOT NULL)")
        db.execute("INSERT OR IGNORE INTO studio_identity_state VALUES('otp_secret',?)", (secrets.token_hex(32),))

    @staticmethod
    def public(db, row):
        user = {key: row[key] for key in ("id", "email", "name")}
        avatar = db.execute("SELECT version FROM studio_account_avatars WHERE account_id=?", (row["id"],)).fetchone()
        user["avatar_url"] = f"/api/backend/studio/auth/profile/avatar?v={avatar['version']}" if avatar else None
        return user

    def resolve(self, token):
        if not token or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return None
        with self.store.transaction() as db:
            self.schema(db)
            row = db.execute("SELECT a.*,s.legacy_access FROM studio_auth_sessions t JOIN studio_accounts a ON a.id=t.account_id JOIN studio_spaces s ON s.id=a.space_id WHERE t.token_hash=? AND t.expires_at>?", (digest(token), int(time.time()))).fetchone()
            return {"id": row["space_id"], "legacy_access": row["legacy_access"], "user": self.public(db, row)} if row else None

    @staticmethod
    def limit(db, key, maximum, expires):
        row = db.execute("SELECT count FROM studio_auth_limits WHERE key=?", (key,)).fetchone()
        if row and row[0] >= maximum:
            raise HTTPException(429, "请求过于频繁，请稍后再试")
        db.execute("INSERT INTO studio_auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1", (key, expires))

    @staticmethod
    def code_hash(db, email, code):
        secret = db.execute("SELECT value FROM studio_identity_state WHERE name='otp_secret'").fetchone()[0]
        return hmac.new(secret.encode(), f"{email}:{code}".encode(), hashlib.sha256).hexdigest()

    def send_code(self, email, space_id, ip):
        if not smtp_ready():
            raise HTTPException(503, "邮箱登录尚未配置，请联系维护者")
        now = int(time.time())
        code = f"{secrets.randbelow(1000000):06d}"
        with self.store.transaction() as db:
            self.schema(db)
            db.execute("DELETE FROM studio_auth_limits WHERE expires_at<=?", (now,))
            db.execute("DELETE FROM studio_email_codes WHERE sent_at<=?", (now - 86400,))
            old = db.execute("SELECT sent_at FROM studio_email_codes WHERE email=?", (email,)).fetchone()
            if old and now - old[0] < 60:
                raise HTTPException(429, "验证码已发送，请 60 秒后重试")
            day = now // 86400
            for key, maximum in (("email:" + digest(email), 10), ("ip:" + digest(ip), 50), ("space:" + space_id, 20)):
                self.limit(db, f"{day}:{key}", maximum, (day + 1) * 86400)
            hashed = self.code_hash(db, email, code)
            db.execute("INSERT OR REPLACE INTO studio_email_codes VALUES(?,?,?,0,0,?)", (email, hashed, now, space_id))
        try:
            send_email(email, code)
        except Exception:
            # Keep the cooldown after ambiguous transport failure; do not resend.
            raise HTTPException(503, "邮件发送未确认，请稍后重新获取验证码") from None
        with self.store.transaction() as db:
            db.execute("UPDATE studio_email_codes SET ready=1 WHERE email=? AND code_hash=?", (email, hashed))
        return {"ok": True, "expires_in": 600, "retry_after": 60}

    def account(self, db, email, space_id, google=None):
        row = db.execute("SELECT * FROM studio_accounts WHERE google_sub=?", (google["sub"],)).fetchone() if google else None
        if not row:
            row = db.execute("SELECT * FROM studio_accounts WHERE email=?", (email,)).fetchone()
            if row and google:
                if row["google_sub"] and row["google_sub"] != google["sub"]:
                    raise HTTPException(409, "该邮箱已关联其他 Google 账号，请使用邮箱验证码登录")
                authoritative = email.endswith("@gmail.com") or bool(google.get("hd"))
                if not authoritative and row["space_id"] != space_id:
                    raise HTTPException(409, "请先使用邮箱验证码登录，再关联此 Google 账号")
                db.execute("UPDATE studio_accounts SET google_sub=? WHERE id=?", (google["sub"], row["id"]))
        if not row:
            # Only unclaimed anonymous spaces can become the new account's space.
            if db.execute("SELECT 1 FROM studio_accounts WHERE space_id=?", (space_id,)).fetchone():
                raise HTTPException(409, "请先退出当前账号，再登录其他账号")
            ident = str(uuid.uuid4())
            name = (str(google.get("name", "")) if google else "")[:80] or email.split("@")[0]
            db.execute("INSERT INTO studio_accounts VALUES(?,?,?,?,?,?)", (ident, email, name, google["sub"] if google else None, space_id, int(time.time())))
            # Permanently retire the old guest capability, including on rollback.
            db.execute("UPDATE studio_spaces SET token_hash=? WHERE id=?", (digest(secrets.token_urlsafe(32)), space_id))
            row = db.execute("SELECT * FROM studio_accounts WHERE id=?", (ident,)).fetchone()
        token = secrets.token_urlsafe(32)
        db.execute("DELETE FROM studio_auth_sessions WHERE expires_at<=?", (int(time.time()),))
        db.execute("INSERT INTO studio_auth_sessions VALUES(?,?,?)", (digest(token), row["id"], int(time.time()) + SESSION_TTL))
        return self.public(db, row), token

    def email_login(self, email, code, space_id):
        result = None
        with self.store.transaction() as db:
            self.schema(db)
            row = db.execute("SELECT * FROM studio_email_codes WHERE email=?", (email,)).fetchone()
            if not row or not row["ready"] or row["space_id"] != space_id or int(time.time()) - row["sent_at"] >= 600 or row["attempts"] >= 5:
                error = "验证码无效或已过期，请重新获取"
            elif not hmac.compare_digest(row["code_hash"], self.code_hash(db, email, code)):
                db.execute("UPDATE studio_email_codes SET attempts=attempts+1 WHERE email=?", (email,))
                error = "验证码错误，请重新输入"
            else:
                result = self.account(db, email, space_id)
                db.execute("DELETE FROM studio_email_codes WHERE email=?", (email,))
        if result is None:
            raise HTTPException(400, error)
        return result

    def nonce(self, space_id):
        nonce = secrets.token_urlsafe(32)
        with self.store.transaction() as db:
            self.schema(db)
            now = int(time.time())
            db.execute("DELETE FROM studio_google_nonces WHERE expires_at<=?", (now,))
            db.execute("INSERT OR REPLACE INTO studio_google_nonces VALUES(?,?,?)", (space_id, digest(nonce), now + 600))
        return nonce

    def google_login(self, claims, space_id):
        try:
            email = email_key(claims.get("email", ""))
        except ValueError:
            raise HTTPException(401, "Google 账号缺少有效邮箱") from None
        if claims.get("email_verified") is not True or not isinstance(claims.get("sub"), str) or not claims["sub"]:
            raise HTTPException(401, "Google 账号尚未验证邮箱")
        with self.store.transaction() as db:
            self.schema(db)
            row = db.execute("SELECT * FROM studio_google_nonces WHERE space_id=?", (space_id,)).fetchone()
            if not row or row["expires_at"] <= int(time.time()) or not hmac.compare_digest(row["nonce_hash"], digest(str(claims.get("nonce", "")))):
                raise HTTPException(401, "Google 登录已过期，请重新打开登录窗口")
            result = self.account(db, email, space_id, claims)
            db.execute("DELETE FROM studio_google_nonces WHERE space_id=?", (space_id,))
            return result


def auth_service():
    from .studio_api import store
    return AuthStore(store)


def login_response(request, response, result):
    user, token = result
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
    response.set_cookie(AUTH_COOKIE, token, max_age=SESSION_TTL, httponly=True, secure=secure, samesite="lax", path="/")
    # Invalidate this browser's previous account session on every sign-in.
    old = request.cookies.get(AUTH_COOKIE)
    if old:
        with auth_service().store.transaction() as db:
            db.execute("DELETE FROM studio_auth_sessions WHERE token_hash=?", (digest(old),))
    return {"user": user}


class EmailBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=254)
    _email = field_validator("email")(email_key)


class CodeBody(EmailBody):
    code: str = Field(pattern=r"^[0-9]{6}$")


class GoogleBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credential: str = Field(min_length=20, max_length=16000)


def create_router():
    router = APIRouter(prefix="/auth")
    from .studio_profile import create_router as profile_router
    router.include_router(profile_router())

    @router.get("/config")
    def config():
        return {"email_enabled": smtp_ready(), "google_client_id": os.environ.get("PLOTLOOM_GOOGLE_CLIENT_ID", "")}

    @router.post("/email-code/send")
    def send(body: EmailBody, request: Request):
        return auth_service().send_code(body.email, current_owner(), request.client.host if request.client else "unknown")

    @router.post("/email-code/login")
    def login(body: CodeBody, request: Request, response: Response):
        return login_response(request, response, auth_service().email_login(body.email, body.code, current_owner()))

    @router.post("/google/nonce")
    def nonce():
        if not os.environ.get("PLOTLOOM_GOOGLE_CLIENT_ID"):
            raise HTTPException(503, "Google 登录尚未配置，请联系维护者")
        return {"nonce": auth_service().nonce(current_owner())}

    @router.post("/google")
    def google(body: GoogleBody, request: Request, response: Response):
        auth = auth_service()
        now = int(time.time())
        with auth.store.transaction() as db:
            auth.schema(db)
            db.execute("DELETE FROM studio_auth_limits WHERE expires_at<=?", (now,))
            ip = request.client.host if request.client else "unknown"
            auth.limit(db, f"google:{now // 60}:{digest(ip)}", 30, (now // 60 + 1) * 60)
        return login_response(request, response, auth_service().google_login(verify_google(body.credential), current_owner()))

    @router.post("/logout")
    def logout(request: Request, response: Response):
        auth = auth_service()
        with auth.store.transaction() as db:
            auth.schema(db)
            db.execute("DELETE FROM studio_auth_sessions WHERE token_hash=?", (digest(request.cookies.get(AUTH_COOKIE, "")),))
        response.delete_cookie(AUTH_COOKIE, path="/")
        # Preserve an unclaimed guest's work; claimed spaces need a fresh guest.
        spaces = SpaceStore(auth.store)
        token = request.cookies.get(COOKIE)
        if not spaces.resolve(token):
            _, token = spaces.create()
        secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
        response.set_cookie(COOKIE, token, max_age=31536000, httponly=True, secure=secure, samesite="lax", path="/")
        return {"ok": True}

    return router
