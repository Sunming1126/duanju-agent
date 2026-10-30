"""Current-account profile and bounded, private avatar storage in the studio DB."""
import hashlib
import io
import time
import unicodedata
import warnings

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .studio_identity import AUTH_COOKIE, current_owner

MAX_AVATAR_BYTES = 2 * 1024 * 1024
MAX_AVATAR_PIXELS = 12_000_000


class ProfileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(max_length=80)

    @field_validator("name", mode="before")
    @classmethod
    def valid_name(cls, value):
        if not isinstance(value, str):
            raise ValueError("昵称必须是文字")
        if any(unicodedata.category(char).startswith("C") for char in value):
            raise ValueError("昵称不能包含控制字符")
        value = value.strip()
        if not value:
            raise ValueError("昵称不能为空")
        return value


def account_row(auth, db, request):
    from .studio_auth import digest
    auth.schema(db)
    row = db.execute(
        "SELECT a.* FROM studio_auth_sessions s JOIN studio_accounts a ON a.id=s.account_id "
        "WHERE s.token_hash=? AND s.expires_at>? AND a.space_id=?",
        (digest(request.cookies.get(AUTH_COOKIE, "")), int(time.time()), current_owner()),
    ).fetchone()
    if not row:
        raise HTTPException(401, "请先登录账号，再管理个人资料")
    return row


def encode_avatar(data):
    from PIL import Image, ImageOps, UnidentifiedImageError
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise HTTPException(415, "仅支持 JPG、PNG 或 WebP 图片")
                if image.width * image.height > MAX_AVATAR_PIXELS:
                    raise HTTPException(413, "图片不能超过 1200 万像素")
                if getattr(image, "is_animated", False):
                    raise HTTPException(415, "请选择静态图片，暂不支持动图")
                image.load()
                normalized = ImageOps.fit(ImageOps.exif_transpose(image).convert("RGBA"), (256, 256), method=Image.Resampling.LANCZOS)
                # Rebuild pixels to avoid retaining metadata in the output.
                clean = Image.frombytes("RGBA", normalized.size, normalized.tobytes())
                output = io.BytesIO()
                clean.save(output, format="WEBP", quality=85)
                return output.getvalue()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(400, "图片无法读取，请选择有效的静态图片") from None


def create_router():
    from .studio_auth import auth_service
    router = APIRouter(prefix="/profile")

    @router.patch("")
    def update(body: ProfileBody, request: Request):
        auth = auth_service()
        with auth.store.transaction() as db:
            row = account_row(auth, db, request)
            db.execute("UPDATE studio_accounts SET name=? WHERE id=?", (body.name, row["id"]))
            row = db.execute("SELECT * FROM studio_accounts WHERE id=?", (row["id"],)).fetchone()
            return {"user": auth.public(db, row)}

    @router.put("/avatar")
    async def upload(request: Request):
        auth = auth_service()
        with auth.store.transaction() as db:
            ident = account_row(auth, db, request)["id"]
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > MAX_AVATAR_BYTES:
                raise HTTPException(413, "头像文件不能超过 2 MiB")
            data.extend(chunk)
        if not data:
            raise HTTPException(400, "请选择头像图片")
        # Decode before taking the write transaction; no image bytes enter JSON.
        from starlette.concurrency import run_in_threadpool
        image = await run_in_threadpool(encode_avatar, bytes(data))
        with auth.store.transaction() as db:
            row = account_row(auth, db, request)
            if row["id"] != ident:
                raise HTTPException(409, "账号已切换，请刷新页面")
            db.execute("INSERT INTO studio_account_avatars VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET image=excluded.image,version=excluded.version",
                       (ident, image, hashlib.sha256(image).hexdigest()))
            return {"user": auth.public(db, row)}

    @router.get("/avatar")
    def avatar(request: Request):
        auth = auth_service()
        with auth.store.transaction() as db:
            row = account_row(auth, db, request)
            image = db.execute("SELECT image,version FROM studio_account_avatars WHERE account_id=?", (row["id"],)).fetchone()
            if not image or (request.query_params.get("v") and request.query_params["v"] != image["version"]):
                raise HTTPException(404, "尚未设置头像")
            return Response(bytes(image["image"]), media_type="image/webp", headers={"Cache-Control": "no-store, private", "Vary": "Cookie", "X-Content-Type-Options": "nosniff"})

    @router.delete("/avatar")
    def remove(request: Request):
        auth = auth_service()
        with auth.store.transaction() as db:
            row = account_row(auth, db, request)
            db.execute("DELETE FROM studio_account_avatars WHERE account_id=?", (row["id"],))
            return {"user": auth.public(db, row)}

    return router
