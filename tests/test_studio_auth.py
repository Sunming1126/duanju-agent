"""Offline authentication contract; temporary databases and fake email/Google only."""
import json
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import studio_main
from agent import studio_api, studio_auth as auth
from agent.studio_identity import AUTH_COOKIE, COOKIE, SpaceStore
from agent.studio_store import StudioStore


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = StudioStore(tmp_path / 'auth.sqlite3')
    monkeypatch.setattr(studio_api, 'store', store)
    for key, value in {'HOST':'smtp.example.com', 'USER':'sender', 'PASSWORD':'test-password', 'FROM':'login@example.com'}.items():
        monkeypatch.setenv('PLOTLOOM_SMTP_' + key, value)
    monkeypatch.setenv('PLOTLOOM_GOOGLE_CLIENT_ID', 'web-client.apps.googleusercontent.com')
    sent = []
    monkeypatch.setattr(auth, 'send_email', lambda email, code: sent.append((email, code)))
    return store, sent


def browser():
    client = TestClient(studio_main.app, base_url='https://testserver')
    response = client.get('/api/studio/session')
    assert response.status_code == 200
    return client, response.json()['space_id']


def post(client, path, value=None):
    return client.post('/api/studio/auth/' + path, json=value or {})


def login(client, sent, email='author@example.com'):
    response = post(client, 'email-code/send', {'email':email})
    assert response.status_code == 200, response.text
    return post(client, 'email-code/login', {'email':email, 'code':sent[-1][1]})


def work(client):
    response = client.post('/api/studio/works', json={'title':'保留的私人作品','premise':'寻找失踪的信'})
    assert response.status_code == 200, response.text
    return response.json()['id']


def expire_code(store):
    with store.transaction() as db:
        db.execute('UPDATE studio_email_codes SET sent_at=?', (int(time.time()) - 601,))


def test_first_email_login_claims_current_space_and_revokes_old_guest_token(setup):
    store, sent = setup
    a, space_id = browser()
    ident = work(a)
    old_guest = a.cookies.get(COOKIE)
    response = login(a, sent, ' AUTHOR@Example.com ')
    assert response.status_code == 200, response.text
    assert response.json()['user']['email'] == 'author@example.com'
    cookie = response.headers['set-cookie'].lower()
    assert 'secure' in cookie and 'httponly' in cookie and 'samesite=lax' in cookie
    info = a.get('/api/studio/session').json()
    assert info['space_id'] == space_id and info['user']['email'] == 'author@example.com'
    assert a.get(f'/api/studio/works/{ident}').status_code == 200
    stolen_guest = TestClient(studio_main.app, base_url='https://testserver')
    stolen_guest.cookies.set(COOKIE, old_guest)
    assert stolen_guest.get(f'/api/studio/works/{ident}').status_code == 401
    with store.transaction() as db:
        raw = json.dumps([tuple(row) for row in db.execute('SELECT * FROM studio_auth_sessions')])
    assert a.cookies.get(AUTH_COOKIE) not in raw
    assert response.headers['cache-control'] == 'no-store, private'


def test_other_browser_login_returns_account_space_logout_revokes_only_own_session(setup):
    store, sent = setup
    a, space_id = browser()
    ident = work(a)
    assert login(a, sent).status_code == 200
    b, guest_id = browser()
    visitor_work = work(b)
    assert login(b, sent).status_code == 200
    assert b.get('/api/studio/session').json()['space_id'] == space_id
    assert b.get(f'/api/studio/works/{ident}').status_code == 200
    assert b.get(f'/api/studio/works/{visitor_work}').status_code == 404
    old_token = b.cookies.get(AUTH_COOKIE)
    assert post(b, 'logout').status_code == 200
    assert b.get('/api/studio/session').json()['space_id'] == guest_id
    assert b.get(f'/api/studio/works/{visitor_work}').status_code == 200
    assert b.get(f'/api/studio/works/{ident}').status_code == 404
    assert auth.AuthStore(store).resolve(old_token) is None
    assert a.get(f'/api/studio/works/{ident}').status_code == 200
    assert post(a, 'logout').status_code == 200
    assert a.get('/api/studio/session').json()['space_id'] != space_id
    assert a.get(f'/api/studio/works/{ident}').status_code == 404


def test_code_once_only_hashed_and_bound_to_requesting_space(setup):
    store, sent = setup
    a, _ = browser()
    b, _ = browser()
    response = post(a, 'email-code/send', {'email':'author@example.com'})
    assert response.status_code == 200 and sent[-1][1] not in response.text
    code = sent[-1][1]
    with store.transaction() as db:
        row = dict(db.execute('SELECT * FROM studio_email_codes').fetchone())
    assert code not in json.dumps(row) and len(row['code_hash']) == 64
    body = {'email':'author@example.com', 'code':code}
    assert post(b, 'email-code/login', body).status_code == 400
    assert post(a, 'email-code/login', body).status_code == 200
    assert post(a, 'email-code/login', body).status_code == 400


def test_code_attempts_commit_and_expired_code_fails(setup):
    store, sent = setup
    a, _ = browser()
    assert post(a, 'email-code/send', {'email':'author@example.com'}).status_code == 200
    correct = sent[-1][1]
    wrong = '000000' if correct != '000000' else '111111'
    for _ in range(5):
        assert post(a, 'email-code/login', {'email':'author@example.com', 'code':wrong}).status_code == 400
    with store.transaction() as db:
        assert db.execute('SELECT attempts FROM studio_email_codes').fetchone()[0] == 5
    assert post(a, 'email-code/login', {'email':'author@example.com', 'code':correct}).status_code == 400
    expire_code(store)
    assert post(a, 'email-code/login', {'email':'author@example.com', 'code':correct}).status_code == 400


def test_send_cooldown_daily_limit_and_transport_failure_do_not_expose_codes(setup, monkeypatch):
    store, sent = setup
    a, _ = browser()
    assert post(a, 'email-code/send', {'email':'author@example.com'}).status_code == 200
    assert post(a, 'email-code/send', {'email':'AUTHOR@example.com'}).status_code == 429
    assert len(sent) == 1
    for _ in range(9):
        expire_code(store)
        assert post(a, 'email-code/send', {'email':'author@example.com'}).status_code == 200
    expire_code(store)
    assert post(a, 'email-code/send', {'email':'author@example.com'}).status_code == 429
    def fail(email, code):
        raise RuntimeError('smtp-secret-must-not-leak')
    monkeypatch.setattr(auth, 'send_email', fail)
    response = post(a, 'email-code/send', {'email':'other@example.com'})
    assert response.status_code == 503 and 'smtp-secret' not in response.text
    with store.transaction() as db:
        assert db.execute("SELECT ready FROM studio_email_codes WHERE email='other@example.com'").fetchone()[0] == 0


def test_disabled_config_never_creates_debug_otp_or_accepts_fake_identity(setup, monkeypatch):
    store, sent = setup
    a, _ = browser()
    monkeypatch.delenv('PLOTLOOM_SMTP_PASSWORD')
    monkeypatch.delenv('PLOTLOOM_GOOGLE_CLIENT_ID')
    config = a.get('/api/studio/auth/config').json()
    assert config == {'email_enabled':False, 'google_client_id':''}
    assert post(a, 'email-code/send', {'email':'a@example.com'}).status_code == 503
    assert post(a, 'google/nonce').status_code == 503
    assert post(a, 'google', {'credential':'f' * 20}).status_code == 503
    assert post(a, 'google', {'googleId':'fake','email':'victim@example.com'}).status_code == 422
    assert not sent


def google_login(client, monkeypatch, email='author@gmail.com', sub='google-user', **changes):
    nonce = post(client, 'google/nonce').json()['nonce']
    claims = {'email':email, 'email_verified':True, 'sub':sub, 'nonce':nonce, **changes}
    monkeypatch.setattr(auth, 'verify_google', lambda credential: claims)
    return post(client, 'google', {'credential':'mock-google-id-token-verified'}), claims


def test_google_verified_subject_nonce_and_email_linking(setup, monkeypatch):
    _, sent = setup
    a, space_id = browser()
    ident = work(a)
    assert login(a, sent, 'author@gmail.com').status_code == 200
    b, _ = browser()
    response, claims = google_login(b, monkeypatch)
    assert response.status_code == 200, response.text
    assert b.get('/api/studio/session').json()['space_id'] == space_id
    assert b.get(f'/api/studio/works/{ident}').status_code == 200
    assert post(b, 'google', {'credential':'mock-google-id-token-verified'}).status_code == 401
    c, _ = browser()
    response, _ = google_login(c, monkeypatch, email='changed@gmail.com')
    assert response.status_code == 200
    assert c.get('/api/studio/session').json()['space_id'] == space_id
    assert 'credential' not in response.text and 'nonce' not in response.text


@pytest.mark.parametrize('changes', [{'nonce':'forged'}, {'email_verified':False}, {'sub':''}, {'email':'invalid'}])
def test_google_rejects_unverified_or_unbound_claims(setup, monkeypatch, changes):
    a, _ = browser()
    response, _ = google_login(a, monkeypatch, **changes)
    assert response.status_code == 401
    assert a.get('/api/studio/session').json()['user'] is None


def test_google_foreign_email_cannot_take_over_email_account(setup, monkeypatch):
    _, sent = setup
    a, _ = browser()
    assert login(a, sent).status_code == 200
    b, _ = browser()
    response, _ = google_login(b, monkeypatch, email='author@example.com')
    assert response.status_code == 409
    response, _ = google_login(a, monkeypatch, email='author@example.com')
    assert response.status_code == 200


def test_server_google_verifier_uses_configured_audience_and_rejects_invalid_tokens(setup, monkeypatch):
    from google.oauth2 import id_token
    observed = []
    def fake_verify(token, request, audience):
        observed.append((token, audience))
        raise ValueError('bad signature, wrong issuer, audience or expired token')
    monkeypatch.setattr(id_token, 'verify_oauth2_token', fake_verify)
    with pytest.raises(HTTPException) as error:
        auth.verify_google('forged')
    assert error.value.status_code == 401
    assert observed == [('forged', 'web-client.apps.googleusercontent.com')]


def test_account_session_expiry_and_csrf_and_stale_tab_mutation_guard(setup):
    store, sent = setup
    a, old_id = browser()
    assert login(a, sent).status_code == 200
    for path in ['email-code/send','email-code/login','google/nonce','google','logout']:
        assert a.post('/api/studio/auth/' + path, json={}, headers={'Origin':'https://evil.example','Sec-Fetch-Site':'cross-site'}).status_code == 403
    assert a.post('/api/studio/works', json={'title':'不应创建'}, headers={'X-Plotloom-Space':'another-tab-space'}).status_code == 409
    assert post(a, 'logout').status_code == 200
    assert a.post('/api/studio/works', json={'title':'不应创建'}, headers={'X-Plotloom-Space':old_id}).status_code == 409
    # A claimed anonymous token must not resurrect an expired account.
    expire_code(store)
    assert login(a, sent).status_code == 200
    with store.transaction() as db:
        db.execute('UPDATE studio_auth_sessions SET expires_at=0')
    assert auth.AuthStore(store).resolve(a.cookies.get(AUTH_COOKIE)) is None
    assert a.get('/api/studio/session').json()['user'] is None
