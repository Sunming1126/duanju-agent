"""Offline membership, access and grant lifecycle against an isolated database."""
import time
import asyncio
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import studio_main
from agent import studio_api
from agent.studio_auth import AuthStore
from agent.studio_identity import AUTH_COOKIE
from agent.studio_membership import add_period, effective, grant, revoke
from agent.studio_store import StudioStore


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = StudioStore(tmp_path / 'member.sqlite3')
    monkeypatch.setattr(studio_api, 'store', store)
    client = TestClient(studio_main.app, base_url='https://testserver')
    space = client.get('/api/studio/session').json()['space_id']
    auth = AuthStore(store)
    with store.transaction() as db:
        auth.schema(db)
        user, token = auth.account(db, 'test@example.com', space)
    client.cookies.set(AUTH_COOKIE, token)
    return store, client, user, space


def test_trial_is_once_and_expires_and_existing_data_remains_readable(setup):
    store, client, user, space = setup
    state = client.get('/api/studio/membership').json()
    assert state['active'] and state['plan'] == 'trial'
    assert 86395 <= state['expires_at'] - int(time.time()) <= 86400
    made = client.post('/api/studio/works', json={'title': '测试作品'})
    assert made.status_code == 200, made.text
    ident = made.json()['id']
    with store.transaction() as db:
        AuthStore(store).account(db, user['email'], space)
        assert db.execute('SELECT COUNT(*) FROM studio_membership_grants').fetchone()[0] == 1
        db.execute('UPDATE studio_membership_grants SET expires_at=? WHERE account_id=?', (int(time.time()) - 1, user['id']))
    assert not client.get('/api/studio/membership').json()['active']
    assert client.get(f'/api/studio/works/{ident}').status_code == 200
    assert client.get(f'/api/studio/works/{ident}/backup').status_code == 200
    for path, payload in [('/api/studio/works', {'title':'不能创建'}), ('/api/studio/worlds', {'name':'不能创建'}), (f'/api/studio/works/{ident}/jobs', {'revision':1,'request_key':'test-request'})]:
        response = client.post(path, json=payload)
        assert response.status_code == 402, response.text
        assert response.json()['detail'] == '此操作需要有效会员，请购买会员。'
    assert client.post('/api/studio/membership', json={'active': True}).status_code == 405


def test_grants_are_stacked_idempotent_and_revocable(setup):
    store, client, user, _ = setup
    now = int(time.time())
    with store.transaction() as db:
        first = grant(db, grant_id='gift-1', account_id=user['id'], plan='monthly', source='admin', reason='support', now=now)
        assert first['starts_at'] == now + 86400
        assert grant(db, grant_id='gift-1', account_id=user['id'], plan='monthly', source='admin', reason='support', now=now) == first
        with pytest.raises(ValueError):
            grant(db, grant_id='gift-1', account_id=user['id'], plan='yearly', source='admin', reason='support', now=now)
        second = grant(db, grant_id='gift-2', account_id=user['id'], plan='yearly', source='admin', reason='support', now=now)
        assert second['starts_at'] == first['expires_at']
        assert effective(db, user['id'], now)['expires_at'] == second['expires_at']
        revoke(db, grant_id='gift-1', reason='correction', now=now)
        assert effective(db, user['id'], now)['expires_at'] == now + 86400
        assert effective(db, user['id'], first['starts_at'])['active'] is False
    assert client.get('/api/studio/membership').status_code == 200


def test_month_and_year_calendar_boundaries():
    jan = int(datetime(2024, 1, 31, 8, tzinfo=timezone.utc).timestamp())
    leap = int(datetime(2024, 2, 29, 8, tzinfo=timezone.utc).timestamp())
    assert add_period(jan, 'monthly') == leap
    assert datetime.fromtimestamp(add_period(leap, 'yearly'), timezone.utc).day == 28
    shanghai_feb_first = int(datetime(2024, 1, 31, 16, tzinfo=timezone.utc).timestamp())
    assert datetime.fromtimestamp(add_period(shanghai_feb_first, 'monthly'), timezone.utc) == datetime(2024, 2, 29, 16, tzinfo=timezone.utc)


def test_worker_does_not_start_queued_generation_after_expiry(setup, monkeypatch):
    from agent import studio_worker
    from agent.studio_inspiration import InspirationStore
    from agent.studio_jobs import JobStore
    store, client, user, _ = setup
    made = client.post('/api/studio/works', json={'title': '排队作品'}).json()
    queued = client.post(f"/api/studio/works/{made['id']}/jobs", json={'revision':1, 'request_key':'queued-expiration-test'}).json()
    with store.transaction() as db:
        db.execute('UPDATE studio_membership_grants SET expires_at=? WHERE account_id=?', (int(time.time()) - 1, user['id']))
    async def unexpected(*args, **kwargs):
        raise AssertionError('expired member must not call model')
    monkeypatch.setattr(studio_worker, 'execute', unexpected)
    assert asyncio.run(studio_worker.run_once(JobStore(store), InspirationStore(store)))
    result = client.get(f"/api/studio/jobs/{queued['id']}").json()
    assert result['status'] == 'failed'
    assert '需要有效会员' in result['error']
