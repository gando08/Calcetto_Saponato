import csv
import html
import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.goal_event import GoalEvent
from app.models.group import Group, GroupPhase
from app.models.match import Match, MatchStatus
from app.models.team import Team
from app.models.tournament import Tournament
from app.services.standings_calculator import calculate_standings

router = APIRouter(prefix="/api/tournaments", tags=["export"])


def _filtered_matches(
    tid: str,
    db: Session,
    gender: str | None = None,
    team_id: str | None = None,
    day_id: str | None = None,
) -> list[Match]:
    query = db.query(Match).join(Group, Match.group_id == Group.id).filter(Group.tournament_id == tid)

    normalized_gender = (gender or "").strip().upper()
    if normalized_gender in {"M", "F"}:
        query = query.filter(Group.gender == normalized_gender)

    if team_id:
        query = query.filter(or_(Match.team_home_id == team_id, Match.team_away_id == team_id))

    if day_id:
        query = query.join(Match.slot).filter(Match.slot.has(day_id=day_id))

    return query.all()


@router.get("/{tid}/export/csv")
def export_csv(
    tid: str,
    gender: str | None = None,
    team_id: str | None = None,
    day_id: str | None = None,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    matches = _filtered_matches(tid, db, gender=gender, team_id=team_id, day_id=day_id)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Girone",
            "Genere",
            "Fase",
            "Squadra Casa",
            "Squadra Ospite",
            "Giorno",
            "Orario",
            "Stato",
            "Gol Casa",
            "Gol Ospite",
        ]
    )

    for match in matches:
        writer.writerow(
            [
                match.group.name if match.group else "",
                match.group.gender if match.group else "",
                match.phase,
                match.team_home.name if match.team_home else match.placeholder_home,
                match.team_away.name if match.team_away else match.placeholder_away,
                match.slot.day.label if match.slot and match.slot.day else "",
                match.slot.start_time if match.slot else "",
                match.status,
                match.result.goals_home if match.result else "",
                match.result.goals_away if match.result else "",
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=calendario_{tid}.csv"},
    )


def _e(text: object) -> str:
    """HTML-escape a value."""
    return html.escape(str(text) if text is not None else "")


def _build_schedule_html(matches: list[Match]) -> str:
    scheduled = [m for m in matches if m.slot_id is not None]
    scheduled.sort(
        key=lambda m: (
            m.slot.day.label if m.slot and m.slot.day else "",
            m.slot.start_time if m.slot else "",
        )
    )

    rows = []
    for m in scheduled:
        result_str = ""
        if m.result and m.status == MatchStatus.PLAYED:
            result_str = f"{m.result.goals_home} - {m.result.goals_away}"

        home_name = m.team_home.name if m.team_home else (m.placeholder_home or "TBD")
        away_name = m.team_away.name if m.team_away else (m.placeholder_away or "TBD")
        gender_class = "gender-M" if (m.group and m.group.gender == "M") else "gender-F"
        gender_label = "M" if (m.group and m.group.gender == "M") else "F"

        rows.append(
            f"<tr>"
            f"<td>{_e(m.slot.day.label if m.slot and m.slot.day else '')}</td>"
            f"<td>{_e(m.slot.start_time if m.slot else '')} - {_e(m.slot.end_time if m.slot else '')}</td>"
            f"<td class='{gender_class}'>{gender_label}</td>"
            f"<td>{_e(m.group.name if m.group else '')}</td>"
            f"<td>{_e(str(m.phase).replace('MatchPhase.', '').lower())}</td>"
            f"<td><strong>{_e(home_name)}</strong></td>"
            f"<td><strong>{_e(away_name)}</strong></td>"
            f"<td class='result'>{_e(result_str)}</td>"
            f"<td>{_e(str(m.status).replace('MatchStatus.', '').lower())}</td>"
            f"</tr>"
        )

    return (
        "<table>"
        "<thead><tr>"
        "<th>Giorno</th><th>Orario</th><th>Gen.</th><th>Girone</th><th>Fase</th>"
        "<th>Casa</th><th>Ospite</th><th>Risultato</th><th>Stato</th>"
        "</tr></thead>"
        "<tbody>" + "".join(rows) + "</tbody>"
        "</table>"
    )


def _build_standings_html(tournament: Tournament, db: Session, gender_filter: str | None = None) -> str:
    config = {
        "points_win": tournament.points_win,
        "points_draw": tournament.points_draw,
        "points_loss": tournament.points_loss,
    }
    tiebreakers = tournament.tiebreaker_order or []

    groups_query = db.query(Group).filter(Group.tournament_id == tournament.id, Group.phase == GroupPhase.GROUP)
    normalized_gender = (gender_filter or "").strip().upper()
    if normalized_gender in {"M", "F"}:
        groups_query = groups_query.filter(Group.gender == normalized_gender)
    groups = groups_query.all()

    sections = []
    for group in groups:
        gender_class = "gender-M" if group.gender == "M" else "gender-F"
        teams_list = [{"id": t.id, "name": t.name} for t in group.teams]
        matches_data = []
        for m in group.matches:
            if m.status == MatchStatus.PLAYED and m.result:
                matches_data.append(
                    {
                        "home": m.team_home_id,
                        "away": m.team_away_id,
                        "goals_home": m.result.goals_home,
                        "goals_away": m.result.goals_away,
                        "yellow_home": m.result.yellow_home,
                        "yellow_away": m.result.yellow_away,
                    }
                )

        standings = calculate_standings([t["id"] for t in teams_list], matches_data, config, tiebreakers)
        team_names = {t["id"]: t["name"] for t in teams_list}

        rows = []
        for idx, row in enumerate(standings, 1):
            rows.append(
                f"<tr>"
                f"<td>{idx}</td>"
                f"<td><strong>{_e(team_names.get(row['team'], row['team']))}</strong></td>"
                f"<td>{row['points']}</td>"
                f"<td>{row['won']}</td>"
                f"<td>{row['drawn']}</td>"
                f"<td>{row['lost']}</td>"
                f"<td>{row['goals_for']}</td>"
                f"<td>{row['goals_against']}</td>"
                f"<td>{row['goal_diff']}</td>"
                f"<td>{row['yellow_cards']}</td>"
                f"</tr>"
            )

        sections.append(
            f"<h3 class='{gender_class}'>{_e(group.name)} ({group.gender})</h3>"
            f"<table><thead><tr>"
            f"<th>#</th><th>Squadra</th><th>Pt</th><th>V</th><th>N</th><th>P</th>"
            f"<th>GF</th><th>GS</th><th>Diff</th><th>FP</th>"
            f"</tr></thead><tbody>{''.join(rows)}</tbody></table>"
        )

    return "".join(sections) if sections else "<p>Nessun girone trovato.</p>"


def _build_scorers_html(tid: str, db: Session, gender_filter: str | None = None) -> str:
    goals = (
        db.query(GoalEvent)
        .join(Match, GoalEvent.match_id == Match.id)
        .join(Group, Match.group_id == Group.id)
        .filter(
            Group.tournament_id == tid,
            GoalEvent.is_own_goal.is_(False),
        )
        .all()
    )

    if not goals:
        return "<p>Nessun marcatore registrato.</p>"

    team_ids = {g.attributed_to_team_id for g in goals}
    teams = db.query(Team).filter(Team.id.in_(team_ids)).all() if team_ids else []
    teams_by_id = {t.id: t for t in teams}

    counter: dict[tuple[str, str], int] = {}
    for goal in goals:
        key_name = goal.player_name_free or (goal.player.name if goal.player else "Sconosciuto")
        pair = (key_name, goal.attributed_to_team_id or "")
        counter[pair] = counter.get(pair, 0) + 1

    sorted_scorers = sorted(counter.items(), key=lambda x: -x[1])

    m_rows, f_rows = [], []
    for (name, team_id), count in sorted_scorers:
        team = teams_by_id.get(team_id)
        team_name = team.name if team else "?"
        gender = team.gender if team else "?"
        row = f"<tr><td>{_e(name)}</td><td>{_e(team_name)}</td><td><strong>{count}</strong></td></tr>"
        if gender_filter and str(gender).upper() != str(gender_filter).upper():
            continue

        if gender == "M":
            m_rows.append(row)
        else:
            f_rows.append(row)

    def _table(rows: list[str], gender_label: str, gender_class: str) -> str:
        if not rows:
            return f"<p>Nessun marcatore {gender_label}.</p>"
        return (
            f"<h3 class='{gender_class}'>{_e(gender_label)}</h3>"
            f"<table><thead><tr><th>Giocatore</th><th>Squadra</th><th>Gol</th></tr></thead>"
            f"<tbody>{''.join(rows)}</tbody></table>"
        )

    return _table(m_rows, "Maschile", "gender-M") + _table(f_rows, "Femminile", "gender-F")


PDF_CSS = """
body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10px;
    color: #222;
    margin: 20mm 15mm;
}
h1 { font-size: 20px; margin-bottom: 4px; }
h2 { font-size: 14px; border-bottom: 2px solid #333; padding-bottom: 3px; margin-top: 16px; }
h3 { font-size: 11px; margin: 8px 0 4px 0; }
p.subtitle { color: #555; font-size: 10px; margin: 0 0 12px 0; }
table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
    font-size: 9px;
}
th, td {
    border: 1px solid #ccc;
    padding: 3px 5px;
    text-align: left;
}
th { background-color: #f0f0f0; font-weight: bold; }
tr:nth-child(even) { background-color: #fafafa; }
.gender-M { color: #1e40af; }
.gender-F { color: #be185d; }
.result { font-weight: bold; }
@page { size: A4; margin: 15mm; }
"""


def _build_full_html(
    tournament: Tournament,
    matches: list[Match],
    db: Session,
    gender_filter: str | None = None,
    team_id: str | None = None,
    day_id: str | None = None,
) -> str:
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")

    schedule_html = _build_schedule_html(matches)
    include_rankings = not team_id and not day_id
    standings_html = _build_standings_html(tournament, db, gender_filter=gender_filter) if include_rankings else "<p>Filtra per torneo completo per includere le classifiche.</p>"
    scorers_html = _build_scorers_html(tournament.id, db, gender_filter=gender_filter) if include_rankings else "<p>Filtra per torneo completo per includere i marcatori.</p>"

    return f"""<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Torneo {_e(tournament.name)}</title>
  <style>{PDF_CSS}</style>
</head>
<body>
  <h1>⚽ Torneo: {_e(tournament.name)}</h1>
  <p class="subtitle">Esportato il {now_str}</p>

  <h2>Calendario Partite</h2>
  {schedule_html}

  <h2>Classifiche Gironi</h2>
  {standings_html}

  <h2>Marcatori</h2>
  {scorers_html}
</body>
</html>"""


@router.get("/{tid}/export/pdf")
def export_pdf(
    tid: str,
    gender: str | None = None,
    team_id: str | None = None,
    day_id: str | None = None,
    db: Session = Depends(get_db),
) -> Response:
    # Validate tournament existence before attempting WeasyPrint import
    tournament = db.query(Tournament).filter(Tournament.id == tid).first()
    if not tournament:
        raise HTTPException(404, "Torneo non trovato")

    try:
        from weasyprint import HTML  # type: ignore[import-untyped]
    except ImportError as exc:
        raise HTTPException(500, "WeasyPrint non installato sul server") from exc

    matches = _filtered_matches(tid, db, gender=gender, team_id=team_id, day_id=day_id)

    html_content = _build_full_html(
        tournament,
        matches,
        db,
        gender_filter=gender,
        team_id=team_id,
        day_id=day_id,
    )
    pdf_bytes: bytes = HTML(string=html_content).write_pdf()

    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in tournament.name)
    filename = f"torneo_{safe_name}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
