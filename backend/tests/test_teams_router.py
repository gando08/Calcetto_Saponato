import json

from fastapi.testclient import TestClient

from app.database import SessionLocal, init_db
from app.main import app
from app.models.slot import Day
from app.models.team import Gender, Team
from app.models.tournament import Tournament

init_db()
client = TestClient(app)


def _seed_tournament_with_final_day() -> dict[str, str]:
    db = SessionLocal()
    try:
        tournament = Tournament(name="Test Team Preferences")
        db.add(tournament)
        db.flush()

        day_normal = Day(
            tournament_id=tournament.id,
            date="2026-09-01",
            label="Giorno 1",
            is_finals_day=False,
            time_windows=json.dumps([{"start": "10:00", "end": "12:00"}]),
        )
        day_final = Day(
            tournament_id=tournament.id,
            date="2026-09-02",
            label="Giorno 2",
            is_finals_day=True,
            time_windows=json.dumps([{"start": "10:00", "end": "12:00"}]),
        )
        db.add_all([day_normal, day_final])
        db.commit()
        return {
            "tid": tournament.id,
            "normal_label": day_normal.label,
            "final_label": day_final.label,
            "final_date": day_final.date,
            "final_id": day_final.id,
        }
    finally:
        db.close()


def test_create_team_removes_final_day_preferences() -> None:
    seeded = _seed_tournament_with_final_day()
    payload = {
        "name": "Team Preferenze",
        "gender": "M",
        "preferred_days": [
            seeded["normal_label"],
            seeded["final_label"],
            seeded["final_date"],
            seeded["final_id"],
        ],
        "preferred_time_windows": [],
        "unavailable_slot_ids": [],
        "prefers_consecutive": False,
    }
    response = client.post(f"/api/tournaments/{seeded['tid']}/teams", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["preferred_days"] == [seeded["normal_label"]]


def test_update_team_removes_final_day_preferences() -> None:
    seeded = _seed_tournament_with_final_day()
    db = SessionLocal()
    try:
        team = Team(
            tournament_id=seeded["tid"],
            name="Team Update",
            gender=Gender.M,
            preferred_days=[seeded["normal_label"]],
        )
        db.add(team)
        db.commit()
        team_id = team.id
    finally:
        db.close()

    update = client.put(
        f"/api/tournaments/{seeded['tid']}/teams/{team_id}",
        json={
            "name": "Team Update",
            "gender": "M",
            "preferred_days": [seeded["final_label"], seeded["normal_label"]],
            "preferred_time_windows": [],
            "unavailable_slot_ids": [],
            "prefers_consecutive": False,
        },
    )
    assert update.status_code == 200, update.text
    body = update.json()
    assert body["preferred_days"] == [seeded["normal_label"]]


def test_import_teams_removes_final_day_preferences() -> None:
    seeded = _seed_tournament_with_final_day()
    csv_content = (
        "nome,genere,giorni_preferiti,fasce_preferite,indisponibilita\n"
        f"Team CSV,M,{seeded['normal_label']};{seeded['final_label']},,\n"
    )
    response = client.post(
        f"/api/tournaments/{seeded['tid']}/teams/import",
        files={"file": ("teams.csv", csv_content, "text/csv")},
    )
    assert response.status_code == 200, response.text

    list_teams = client.get(f"/api/tournaments/{seeded['tid']}/teams")
    assert list_teams.status_code == 200
    imported = next(team for team in list_teams.json() if team["name"] == "Team CSV")
    assert imported["preferred_days"] == [seeded["normal_label"]]
