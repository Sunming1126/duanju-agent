"""Login is required before mutations, with no model or SMTP calls."""
import pytest
from fastapi.testclient import TestClient
import studio_main
from agent import studio_api
from agent.studio_store import StudioStore
from agent.studio_identity import AUTH_COOKIE
from studio_test_scope import sign_in_browser

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(studio_api, 'store', StudioStore(tmp_path/'login.sqlite3'))
    return TestClient(studio_main.app, base_url='https://testserver')

@pytest.mark.parametrize('method,path,payload', [
    ('post','/works',{'title':'Guest novel','content_type':'novel'}),
    ('post','/works',{'title':'Guest script','content_type':'short_drama'}),
    ('put','/works/missing',{}), ('patch','/works/missing/archive',{}),
    ('post','/works/import',{}), ('post','/works/missing/duplicate',{}),
    ('post','/works/missing/generate',{}), ('post','/works/missing/jobs',{}),
    ('post','/jobs/missing/resume',{}), ('post','/jobs/missing/adopt',{}),
    ('post','/inspirations',{}), ('put','/inspirations/x/plans/y',{}),
    ('post','/inspirations/x/actions',{}), ('post','/inspiration-jobs/x/resume',{}),
    ('post','/history/missing/import',{}),
])
def test_guest_and_forged_account_cannot_use_creation(client, method, path, payload):
    client.get('/api/studio/session')
    client.cookies.set(AUTH_COOKIE,'forged-account')
    response = getattr(client,method)('/api/studio'+path,json=payload)
    assert response.status_code == 401
    assert response.json()['detail'] == '请先登录后使用小说或剧本创作。'
    assert studio_api.store.list('works') == []

@pytest.mark.parametrize('kind',['novel','short_drama'])
def test_authenticated_creation_and_logout_revokes_access(client,kind):
    assert client.get('/api/studio/session').json()['user'] is None
    info = sign_in_browser(client)
    response = client.post('/api/studio/works',json={'title':'Authenticated story','content_type':kind})
    assert response.status_code == 200
    ident = response.json()['id']
    assert client.get('/api/studio/session').json()['space_id'] == info['space_id']
    credential = client.cookies.get(AUTH_COOKIE)
    assert client.post('/api/studio/auth/logout',json={}).status_code == 200
    client.cookies.set(AUTH_COOKIE,credential)
    assert client.post('/api/studio/works',json={'title':'No longer signed in'}).status_code == 401
    assert client.post('/api/studio/works/'+ident+'/jobs',json={}).status_code == 401
    assert client.get('/api/studio/worlds').status_code == 200
