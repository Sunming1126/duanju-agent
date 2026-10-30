"""Offline authentication contract; temporary databases and fake email/Google only."""
import json
import io
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import studio_main
from agent import studio_api, studio_auth as auth
from agent.studio_identity import AUTH_COOKIE, COOKIE, SpaceStore
from agent.studio_store import StudioStore


def avatar_bytes(format="PNG", size=(120, 80), color="red", **options):
    from PIL import Image
    stream = io.BytesIO()
    Image.new("RGB", size, color).save(stream, format=format, **options)
    return stream.getvalue()


PROFILE = "/api/studio/auth/profile"


def test_profile_updates_are_private_persist_and_leave_manuscript_ownership_unchanged(setup):
    store, sent = setup
    client, space = browser()
    ident = work(client)
    assert login(client, sent).status_code == 200
    with store.transaction() as db:
        before = list(map(tuple, db.execute("SELECT * FROM works")))
    response = client.patch(PROFILE, json={"name": "  新笔名  "})
    assert response.status_code == 200 and response.json()["user"]["name"] == "新笔名"
    assert response.json()["user"]["avatar_url"] is None
    assert response.headers["cache-control"] == "no-store, private"
    assert client.get('/api/studio/session').json()['space_id'] == space
    assert client.get('/api/studio/session').json()['user']['name'] == '新笔名'
    other, _ = browser()
    assert login(other, sent).status_code == 200
    assert other.get('/api/studio/session').json()['user']['name'] == '新笔名'
    assert other.get(f'/api/studio/works/{ident}').status_code == 200
    with store.transaction() as db:
        assert list(map(tuple, db.execute("SELECT * FROM works"))) == before


@pytest.mark.parametrize('name', ['', '   ', 'x' * 81, 'a\nb', '\x00name', 'a\u200bb', 123])
def test_profile_rejects_invalid_names_without_changing_account(setup, name):
    _, sent = setup
    client, _ = browser()
    assert login(client, sent).status_code == 200
    before = client.get('/api/studio/session').json()['user']
    assert client.patch(PROFILE, json={'name': name}).status_code == 422
    assert client.get('/api/studio/session').json()['user'] == before


def test_profile_rejects_account_switch_and_cross_origin_and_protected_fields(setup):
    _, sent = setup
    guest, guest_space = browser()
    assert guest.patch(PROFILE, json={'name': '访客'}).status_code == 401
    assert guest.put(PROFILE + '/avatar', content=avatar_bytes()).status_code == 401
    assert guest.get(PROFILE + '/avatar').status_code == 401
    assert guest.delete(PROFILE + '/avatar').status_code == 401
    client, _ = browser()
    assert login(client, sent).status_code == 200
    assert client.patch(PROFILE, json={'name': 'a'}, headers={'X-Plotloom-Space': guest_space}).status_code == 409
    assert client.patch(PROFILE, json={'name': 'a'}, headers={'Origin': 'https://foreign.test'}).status_code == 403
    assert client.put(PROFILE + '/avatar', content=avatar_bytes(), headers={'Origin': 'https://foreign.test'}).status_code == 403
    assert client.delete(PROFILE + '/avatar', headers={'X-Plotloom-Space': guest_space}).status_code == 409
    assert client.patch(PROFILE, json={'name': 'a', 'email': 'other@example.com'}).status_code == 422


@pytest.mark.parametrize('format', ['PNG', 'JPEG', 'WEBP'])
def test_avatar_reencoded_persisted_private_and_removed(setup, format):
    from PIL import Image
    _, sent = setup
    client, _ = browser()
    assert login(client, sent).status_code == 200
    assert client.get(PROFILE + '/avatar').status_code == 404
    response = client.put(PROFILE + '/avatar', content=avatar_bytes(format))
    assert response.status_code == 200, response.text
    url = response.json()['user']['avatar_url']
    assert url.startswith('/api/backend/studio/auth/profile/avatar?v=')
    image = client.get(PROFILE + '/avatar')
    assert image.status_code == 200 and image.headers['content-type'] == 'image/webp'
    assert image.headers['cache-control'] == 'no-store, private' and 'Cookie' in image.headers['vary']
    assert image.headers['x-content-type-options'] == 'nosniff'
    decoded = Image.open(io.BytesIO(image.content))
    assert decoded.format == 'WEBP' and decoded.size == (256, 256) and not decoded.info.get('exif')
    guest, _ = browser()
    assert guest.get(PROFILE + '/avatar').status_code == 401
    assert login(guest, sent, 'another@example.com').status_code == 200
    assert guest.get(PROFILE + '/avatar').status_code == 404
    second, _ = browser()
    assert login(second, sent).status_code == 200
    assert second.get(PROFILE + '/avatar').content == image.content
    assert second.get('/api/studio/session').json()['user']['avatar_url'] == url
    assert client.delete(PROFILE + '/avatar').json()['user']['avatar_url'] is None
    assert second.get(PROFILE + '/avatar').status_code == 404


def test_avatar_size_pixels_animation_and_invalid_bytes_preserve_existing_avatar(setup):
    from PIL import Image
    _, sent = setup
    client, _ = browser()
    assert login(client, sent).status_code == 200
    assert client.put(PROFILE + '/avatar', content=avatar_bytes()).status_code == 200
    before = client.get(PROFILE + '/avatar').content
    animation = io.BytesIO()
    Image.new('RGB', (10, 10), 'red').save(animation, format='PNG', save_all=True, append_images=[Image.new('RGB', (10, 10), 'blue')], duration=100)
    cases = [(b'', 400), (b'<svg></svg>', 400), (b'not a png', 400), (b'x' * (2 * 1024 * 1024 + 1), 413),
             (avatar_bytes(size=(3500, 3500)), 413), (avatar_bytes('GIF'), 415), (animation.getvalue(), 415), (avatar_bytes()[:40], 400)]
    for data, expected in cases:
        response = client.put(PROFILE + '/avatar', content=data, headers={'Content-Type': 'image/png'})
        assert response.status_code == expected, response.text
        assert client.get(PROFILE + '/avatar').content == before


def test_custom_name_and_avatar_survive_subsequent_google_login(setup, monkeypatch):
    _, sent = setup
    client, _ = browser()
    assert login(client, sent, 'author@gmail.com').status_code == 200
    assert client.patch(PROFILE, json={'name': '我的笔名'}).status_code == 200
    avatar = client.put(PROFILE + '/avatar', content=avatar_bytes()).json()['user']['avatar_url']
    nonce = post(client, 'google/nonce').json()['nonce']
    monkeypatch.setattr(auth, 'verify_google', lambda _: {'sub': 'stable-google-user', 'email': 'author@gmail.com', 'email_verified': True, 'name': 'Google 名称', 'nonce': nonce})
    result = post(client, 'google', {'credential': 'x' * 30})
    assert result.status_code == 200
    assert result.json()['user']['name'] == '我的笔名' and result.json()['user']['avatar_url'] == avatar


def test_profile_additive_schema_preserves_existing_accounts_and_exif_is_removed(setup):
    from PIL import Image
    store, sent = setup
    client, space = browser()
    assert login(client, sent).status_code == 200
    with store.transaction() as db:
        before = list(map(tuple, db.execute('SELECT * FROM studio_accounts')))
        db.execute('DROP TABLE studio_account_avatars')
    assert client.get('/api/studio/session').json()['user']['avatar_url'] is None
    with store.transaction() as db:
        assert list(map(tuple, db.execute('SELECT * FROM studio_accounts'))) == before
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = 'private image description'
    assert client.put(PROFILE + '/avatar', content=avatar_bytes('JPEG', exif=exif)).status_code == 200
    output = Image.open(io.BytesIO(client.get(PROFILE + '/avatar').content))
    assert not output.getexif() and 'exif' not in output.info
    old = client.get('/api/studio/session').json()['user']['avatar_url'].replace('/api/backend/', '/api/')
    assert client.put(PROFILE + '/avatar', content=avatar_bytes(color='blue')).status_code == 200
    assert client.get(old).status_code == 404
    assert client.get('/api/studio/session').json()['space_id'] == space


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
