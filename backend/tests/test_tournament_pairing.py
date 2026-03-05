from app.database import SessionLocal, init_db
from app.models.team import Gender
from app.models.tournament import Tournament
from app.services.tournament_pairing import resolve_pair_tournament_ids

init_db()


def _seed_pair() -> tuple[str, str]:
    db = SessionLocal()
    try:
        male = Tournament(name="Coppa Estate 2026 - Maschile", gender=Gender.M)
        female = Tournament(name="Coppa Estate 2026 - Femminile", gender=Gender.F)
        db.add_all([male, female])
        db.commit()
        return male.id, female.id
    finally:
        db.close()


def test_resolve_pair_tournament_ids_returns_both_ids_for_pair() -> None:
    male_id, female_id = _seed_pair()
    db = SessionLocal()
    try:
        pair_ids = resolve_pair_tournament_ids(male_id, db)
        assert male_id == pair_ids[0]
        assert {male_id, female_id}.issubset(set(pair_ids))
    finally:
        db.close()


def test_resolve_pair_tournament_ids_returns_self_if_no_pair() -> None:
    db = SessionLocal()
    try:
        single = Tournament(name="Torneo Singolo 2026")
        db.add(single)
        db.commit()

        pair_ids = resolve_pair_tournament_ids(single.id, db)
        assert pair_ids == [single.id]
    finally:
        db.close()
