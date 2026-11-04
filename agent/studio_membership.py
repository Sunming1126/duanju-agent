"""Account-bound membership records. No public grant or payment endpoint."""
import calendar
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request

REQUIRED = "此操作需要有效会员，请购买会员。"


def schema(db):
    db.execute("""CREATE TABLE IF NOT EXISTS studio_membership_grants(
        grant_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES studio_accounts(id),
        plan TEXT NOT NULL CHECK(plan IN ('trial','monthly','yearly')),
        source TEXT NOT NULL, starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL, reason TEXT NOT NULL,
        revoked_at INTEGER, revoked_reason TEXT)""")
    db.execute("CREATE INDEX IF NOT EXISTS studio_membership_account ON studio_membership_grants(account_id, expires_at)")
    db.execute("""CREATE TABLE IF NOT EXISTS studio_lifetime_memberships(
        account_id TEXT PRIMARY KEY REFERENCES studio_accounts(id), source TEXT NOT NULL,
        created_at INTEGER NOT NULL, reason TEXT NOT NULL)""")


def grant_existing_lifetime_once(db):
    """Snapshot existing accounts once before any account is created by this version."""
    schema(db)
    key = 'membership_lifetime_existing_v1'
    if db.execute('SELECT 1 FROM studio_identity_state WHERE name=?', (key,)).fetchone():
        return
    now = int(time.time())
    db.execute("""INSERT OR IGNORE INTO studio_lifetime_memberships(account_id,source,created_at,reason)
                  SELECT id,'existing_account',?,'development testing' FROM studio_accounts""", (now,))
    db.execute('INSERT INTO studio_identity_state(name,value) VALUES(?,?)', (key, str(now)))


def trial(db, account_id, now=None, source='registration'):
    now = int(time.time()) if now is None else int(now)
    schema(db)
    db.execute("INSERT OR IGNORE INTO studio_membership_grants VALUES(?,?,?,?,?,?,?,?,NULL,NULL)",
               (f"trial:{account_id}", account_id, 'trial', source, now, now + 86400, now, source))


def effective(db, account_id, now=None):
    now = int(time.time()) if now is None else int(now)
    schema(db)
    if db.execute('SELECT 1 FROM studio_lifetime_memberships WHERE account_id=?', (account_id,)).fetchone():
        return {"active": True, "plan": "lifetime", "expires_at": None, "last_expired_at": None}
    rows = db.execute("SELECT * FROM studio_membership_grants WHERE account_id=? AND revoked_at IS NULL ORDER BY expires_at DESC", (account_id,)).fetchall()
    active = next((r for r in rows if r['starts_at'] <= now < r['expires_at']), None)
    expiry = active['expires_at'] if active else None
    if expiry:
        for row in sorted(rows, key=lambda item: item['starts_at']):
            if row['starts_at'] <= expiry:
                expiry = max(expiry, row['expires_at'])
    latest = rows[0] if rows else None
    return {"active": bool(active), "plan": active['plan'] if active else None,
            "expires_at": expiry, "last_expired_at": latest['expires_at'] if latest and not active and latest['expires_at'] <= now else None}


def add_period(timestamp, plan):
    # Match ChatChat's calendar-month rules, including end-of-month clamping.
    date = datetime.fromtimestamp(timestamp, timezone(timedelta(hours=8)))
    month_index = date.year * 12 + date.month - 1 + (1 if plan == 'monthly' else 12)
    year, month0 = divmod(month_index, 12)
    month = month0 + 1
    return int(date.replace(year=year, month=month, day=min(date.day, calendar.monthrange(year, month)[1])).timestamp())


def grant(db, *, grant_id, account_id, plan, source, reason, now=None):
    """Internal integration seam; callers must authenticate and authorize externally."""
    if not grant_id or len(grant_id) > 160 or plan not in {'monthly', 'yearly'} or not source or not reason:
        raise ValueError('invalid grant')
    now = int(time.time()) if now is None else int(now)
    schema(db)
    old = db.execute('SELECT * FROM studio_membership_grants WHERE grant_id=?', (grant_id,)).fetchone()
    if old:
        if (old['account_id'], old['plan'], old['source'], old['reason']) != (account_id, plan, source, reason):
            raise ValueError('grant ID already used with different parameters')
        return dict(old)
    if not db.execute('SELECT 1 FROM studio_accounts WHERE id=?', (account_id,)).fetchone():
        raise ValueError('account not found')
    state = effective(db, account_id, now)
    starts = max(now, state['expires_at'] or now)
    db.execute('INSERT INTO studio_membership_grants VALUES(?,?,?,?,?,?,?,?,NULL,NULL)',
               (grant_id, account_id, plan, source, starts, add_period(starts, plan), now, reason))
    return dict(db.execute('SELECT * FROM studio_membership_grants WHERE grant_id=?', (grant_id,)).fetchone())


def revoke(db, *, grant_id, reason, now=None):
    if not reason:
        raise ValueError('reason required')
    schema(db)
    row = db.execute('SELECT * FROM studio_membership_grants WHERE grant_id=?', (grant_id,)).fetchone()
    if not row:
        raise ValueError('grant not found')
    if row['revoked_at'] is None:
        db.execute('UPDATE studio_membership_grants SET revoked_at=?, revoked_reason=? WHERE grant_id=?',
                   (int(time.time()) if now is None else int(now), reason, grant_id))


def active_for_space(store, space_id):
    with store.transaction() as db:
        from .studio_auth import AuthStore
        AuthStore.schema(db)
        account = db.execute('SELECT id FROM studio_accounts WHERE space_id=?', (space_id,)).fetchone()
        return bool(account and effective(db, account['id'])['active'])


def create_router():
    router = APIRouter()

    @router.get('/membership')
    def membership(request: Request):
        from .studio_auth import auth_service
        identity = auth_service().resolve(request.cookies.get('plotloom_account'))
        if not identity or not identity.get('user'):
            raise HTTPException(401, '请先登录后查看会员状态。')
        with auth_service().store.transaction() as db:
            return effective(db, identity['user']['id'])

    return router
