from fastapi.testclient import TestClient

from app.database import SessionLocal, init_db
from app.main import app
from app.models.team import Gender
from app.models.tournament import Tournament
from app.services import scheduler as scheduler_service

init_db()
client = TestClient(app)


def _seed_pair() -> tuple[str, str]:
    db = SessionLocal()
    try:
        male = Tournament(name="Memorial Riva 2026 - Maschile", gender=Gender.M)
        female = Tournament(name="Memorial Riva 2026 - Femminile", gender=Gender.F)
        db.add_all([male, female])
        db.commit()
        return male.id, female.id
    finally:
        db.close()


def test_generate_schedule_auto_includes_companion(monkeypatch) -> None:
    male_id, female_id = _seed_pair()
    captured: dict[str, object] = {}

    def _fake_start_scheduling(tid, db, on_progress, companion_tids=None):
        captured["tid"] = tid
        captured["companions"] = list(companion_tids or [])

    monkeypatch.setattr("app.routers.schedule.scheduler_service.start_scheduling", _fake_start_scheduling)

    response = client.post(f"/api/tournaments/{male_id}/schedule/generate", json={})
    assert response.status_code == 200
    assert response.json()["status"] == "started"
    assert captured["tid"] == male_id
    assert female_id in (captured["companions"] or [])


def test_schedule_save_aliases_apply(monkeypatch) -> None:
    tid, _ = _seed_pair()

    called = {"count": 0}

    def _fake_apply_solution(tournament_id, db):
        called["count"] += 1
        return tournament_id == tid

    monkeypatch.setattr(scheduler_service, "apply_solution", _fake_apply_solution)

    response = client.post(f"/api/tournaments/{tid}/schedule/save")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["saved_tournaments"] >= 1
