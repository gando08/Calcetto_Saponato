"""Tests for the export endpoints (CSV and PDF)."""

import importlib.util

import pytest
from fastapi.testclient import TestClient

_weasyprint_available = importlib.util.find_spec("weasyprint") is not None
skip_without_weasyprint = pytest.mark.skipif(
    not _weasyprint_available,
    reason="WeasyPrint not installed (available inside Docker)",
)

from app.database import SessionLocal, init_db
from app.main import app
from app.models.group import Group, GroupPhase
from app.models.match import Match, MatchStatus
from app.models.result import Result
from app.models.slot import Day, Slot
from app.models.team import Gender, Team
from app.models.tournament import Tournament

init_db()
client = TestClient(app)


def _seed_exportable_tournament() -> dict:
    db = SessionLocal()
    try:
        tournament = Tournament(
            name="Export Test Torneo",
            match_duration_minutes=30,
            buffer_minutes=0,
        )
        db.add(tournament)
        db.flush()

        m_home = Team(tournament_id=tournament.id, name="Export Home M", gender=Gender.M)
        m_away = Team(tournament_id=tournament.id, name="Export Away M", gender=Gender.M)
        f_home = Team(tournament_id=tournament.id, name="Export Home F", gender=Gender.F)
        f_away = Team(tournament_id=tournament.id, name="Export Away F", gender=Gender.F)
        db.add_all([m_home, m_away, f_home, f_away])
        db.flush()

        group_m = Group(
            tournament_id=tournament.id,
            name="Girone Export M",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        group_f = Group(
            tournament_id=tournament.id,
            name="Girone Export F",
            gender="F",
            phase=GroupPhase.GROUP,
        )
        db.add_all([group_m, group_f])
        db.flush()

        import json
        day1 = Day(
            tournament_id=tournament.id,
            date="2026-06-01",
            label="Giorno 1",
            is_finals_day=False,
            time_windows=json.dumps([{"start": "10:00", "end": "10:30"}]),
        )
        day2 = Day(
            tournament_id=tournament.id,
            date="2026-06-02",
            label="Giorno 2",
            is_finals_day=False,
            time_windows=json.dumps([{"start": "10:00", "end": "10:30"}]),
        )
        db.add_all([day1, day2])
        db.flush()

        slot1 = Slot(day_id=day1.id, start_time="10:00", end_time="10:30")
        slot2 = Slot(day_id=day2.id, start_time="10:00", end_time="10:30")
        db.add_all([slot1, slot2])
        db.flush()

        match_m = Match(
            group_id=group_m.id,
            team_home_id=m_home.id,
            team_away_id=m_away.id,
            slot_id=slot1.id,
            status=MatchStatus.PLAYED,
        )
        match_f = Match(
            group_id=group_f.id,
            team_home_id=f_home.id,
            team_away_id=f_away.id,
            slot_id=slot2.id,
            status=MatchStatus.PLAYED,
        )
        db.add_all([match_m, match_f])
        db.flush()

        result_m = Result(match_id=match_m.id, goals_home=3, goals_away=1)
        result_f = Result(match_id=match_f.id, goals_home=2, goals_away=2)
        db.add_all([result_m, result_f])

        db.commit()
        return {
            "tid": tournament.id,
            "day1_id": day1.id,
            "day2_id": day2.id,
            "m_home_id": m_home.id,
            "f_home_id": f_home.id,
        }
    finally:
        db.close()


def test_export_csv_returns_csv_content() -> None:
    seeded = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{seeded['tid']}/export/csv")

    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    content = response.text
    # Header row
    assert "Squadra Casa" in content
    assert "Squadra Ospite" in content
    # Data row
    assert "Export Home M" in content
    assert "Export Away M" in content


def test_export_csv_includes_results() -> None:
    seeded = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{seeded['tid']}/export/csv")

    assert response.status_code == 200
    content = response.text
    # Goals should appear in the CSV
    assert "3" in content
    assert "1" in content


def test_export_csv_content_disposition_header() -> None:
    seeded = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{seeded['tid']}/export/csv")

    assert response.status_code == 200
    content_disp = response.headers.get("content-disposition", "")
    assert "attachment" in content_disp
    assert ".csv" in content_disp


def test_export_csv_can_filter_by_gender() -> None:
    seeded = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{seeded['tid']}/export/csv?gender=M")

    assert response.status_code == 200
    content = response.text
    assert "Export Home M" in content
    assert "Export Home F" not in content


def test_export_csv_can_filter_by_day_id() -> None:
    seeded = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{seeded['tid']}/export/csv?day_id={seeded['day2_id']}")

    assert response.status_code == 200
    content = response.text
    assert "Giorno 2" in content
    assert "Giorno 1" not in content


def test_export_csv_can_filter_by_team_id() -> None:
    seeded = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{seeded['tid']}/export/csv?team_id={seeded['f_home_id']}")

    assert response.status_code == 200
    content = response.text
    assert "Export Home F" in content
    assert "Export Home M" not in content


@skip_without_weasyprint
def test_export_pdf_returns_pdf_bytes() -> None:
    seeded = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{seeded['tid']}/export/pdf")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    # PDF magic bytes
    assert response.content[:4] == b"%PDF"


@skip_without_weasyprint
def test_export_pdf_content_disposition_header() -> None:
    seeded = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{seeded['tid']}/export/pdf")

    assert response.status_code == 200
    content_disp = response.headers.get("content-disposition", "")
    assert "attachment" in content_disp
    assert ".pdf" in content_disp


def test_export_pdf_returns_404_for_unknown_tournament() -> None:
    response = client.get("/api/tournaments/nonexistent-id/export/pdf")
    assert response.status_code == 404
