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


def _seed_exportable_tournament() -> str:
    db = SessionLocal()
    try:
        tournament = Tournament(
            name="Export Test Torneo",
            match_duration_minutes=30,
            buffer_minutes=0,
        )
        db.add(tournament)
        db.flush()

        home = Team(tournament_id=tournament.id, name="Export Home", gender=Gender.M)
        away = Team(tournament_id=tournament.id, name="Export Away", gender=Gender.M)
        db.add_all([home, away])
        db.flush()

        group = Group(
            tournament_id=tournament.id,
            name="Girone Export",
            gender="M",
            phase=GroupPhase.GROUP,
        )
        db.add(group)
        db.flush()

        import json
        day = Day(
            tournament_id=tournament.id,
            date="2026-06-01",
            label="Giorno 1",
            is_finals_day=False,
            time_windows=json.dumps([{"start": "10:00", "end": "10:30"}]),
        )
        db.add(day)
        db.flush()

        slot = Slot(day_id=day.id, start_time="10:00", end_time="10:30")
        db.add(slot)
        db.flush()

        match = Match(
            group_id=group.id,
            team_home_id=home.id,
            team_away_id=away.id,
            slot_id=slot.id,
            status=MatchStatus.PLAYED,
        )
        db.add(match)
        db.flush()

        result = Result(match_id=match.id, goals_home=3, goals_away=1)
        db.add(result)

        db.commit()
        return tournament.id
    finally:
        db.close()


def test_export_csv_returns_csv_content() -> None:
    tid = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{tid}/export/csv")

    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    content = response.text
    # Header row
    assert "Squadra Casa" in content
    assert "Squadra Ospite" in content
    # Data row
    assert "Export Home" in content
    assert "Export Away" in content


def test_export_csv_includes_results() -> None:
    tid = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{tid}/export/csv")

    assert response.status_code == 200
    content = response.text
    # Goals should appear in the CSV
    assert "3" in content
    assert "1" in content


def test_export_csv_content_disposition_header() -> None:
    tid = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{tid}/export/csv")

    assert response.status_code == 200
    content_disp = response.headers.get("content-disposition", "")
    assert "attachment" in content_disp
    assert ".csv" in content_disp


@skip_without_weasyprint
def test_export_pdf_returns_pdf_bytes() -> None:
    tid = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{tid}/export/pdf")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    # PDF magic bytes
    assert response.content[:4] == b"%PDF"


@skip_without_weasyprint
def test_export_pdf_content_disposition_header() -> None:
    tid = _seed_exportable_tournament()
    response = client.get(f"/api/tournaments/{tid}/export/pdf")

    assert response.status_code == 200
    content_disp = response.headers.get("content-disposition", "")
    assert "attachment" in content_disp
    assert ".pdf" in content_disp


def test_export_pdf_returns_404_for_unknown_tournament() -> None:
    response = client.get("/api/tournaments/nonexistent-id/export/pdf")
    assert response.status_code == 404
