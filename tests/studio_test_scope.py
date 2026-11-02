"""Give API regression fixtures and their internal setup the same real identity."""
from contextlib import contextmanager
from fastapi.testclient import TestClient
from agent.studio_identity import actor


def sign_in_browser(client):
    """Seed a real account/session in the temporary DB without email or Google calls."""
    from agent.studio_auth import auth_service
    from agent.studio_identity import AUTH_COOKIE
    space = client.get("/api/studio/session", headers={"X-Duanju-Site": "china"}).json()
    service = auth_service()
    with service.store.transaction() as db:
        service.schema(db)
        _, credential = service.account(db, space['space_id'] + '@example.test', space['space_id'])
    client.cookies.set(AUTH_COOKIE, credential)
    return client.get("/api/studio/session", headers={"X-Duanju-Site": "china"}).json()


@contextmanager
def browser_scope(app):
    client = TestClient(app, headers={"X-Duanju-Site": "china"})
    response = client.get("/api/studio/session")
    assert response.status_code == 200, response.text
    sign_in_browser(client)
    token = actor.set(response.json()["space_id"])
    try:
        yield client
    finally:
        actor.reset(token)
