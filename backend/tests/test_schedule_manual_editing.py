from fastapi.testclient import TestClient

from app.database import init_db
from app.main import app

init_db()
client = TestClient(app)


def test_patch_match_slot_returns_404_for_missing_match() -> None:
    res = client.patch("/api/matches/missing/slot", json={"slot_id": "x"})
    assert res.status_code == 404
    assert res.json()["detail"] == "Partita non trovata"


def test_patch_match_lock_returns_404_for_missing_match() -> None:
    res = client.patch("/api/matches/missing/lock", json={"locked": True})
    assert res.status_code == 404
    assert res.json()["detail"] == "Partita non trovata"
