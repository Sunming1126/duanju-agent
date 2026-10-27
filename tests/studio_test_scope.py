"""Give API regression fixtures and their internal setup the same real identity."""
from contextlib import contextmanager
from fastapi.testclient import TestClient
from agent.studio_identity import actor


@contextmanager
def browser_scope(app):
    client = TestClient(app, headers={"X-Duanju-Site": "china"})
    response = client.get("/api/studio/session")
    assert response.status_code == 200, response.text
    token = actor.set(response.json()["space_id"])
    try:
        yield client
    finally:
        actor.reset(token)
