import re
from typing import Optional

from sqlalchemy.orm import Session

from app.models.tournament import Tournament

_MALE_SUFFIX_RE = re.compile(r"\s*(?:[-_/]|\(|\[)?\s*(?:m|maschile)\s*(?:\)|\])?\s*$", re.IGNORECASE)
_FEMALE_SUFFIX_RE = re.compile(r"\s*(?:[-_/]|\(|\[)?\s*(?:f|femminile)\s*(?:\)|\])?\s*$", re.IGNORECASE)
_YEAR_SUFFIX_RE = re.compile(r"\s(20\d{2}|21\d{2})$")


def _normalize_spaces(value: str) -> str:
    return " ".join((value or "").split()).strip()


def _normalize_gender(tournament: Tournament) -> Optional[str]:
    raw_gender = getattr(tournament, "gender", None)
    raw_value = getattr(raw_gender, "value", raw_gender)
    if raw_value in {"M", "F"}:
        return str(raw_value)

    name = _normalize_spaces(tournament.name or "").lower()
    if _MALE_SUFFIX_RE.search(name):
        return "M"
    if _FEMALE_SUFFIX_RE.search(name):
        return "F"
    return None


def _strip_gender_suffix(name: str) -> str:
    clean = _normalize_spaces(name)
    stripped = _FEMALE_SUFFIX_RE.sub("", _MALE_SUFFIX_RE.sub("", clean))
    return _normalize_spaces(stripped) or clean


def _pair_key(tournament: Tournament) -> Optional[str]:
    gender = _normalize_gender(tournament)
    if gender not in {"M", "F"}:
        return None

    no_gender = _strip_gender_suffix(tournament.name or "")
    year_match = _YEAR_SUFFIX_RE.search(no_gender)
    year = year_match.group(1) if year_match else "none"
    base_name = no_gender[: year_match.start()].strip() if year_match else no_gender
    normalized_base = _normalize_spaces(base_name).lower()
    return f"{normalized_base}::{year}" if normalized_base else None


def resolve_pair_tournament_ids(tid: str, db: Session) -> list[str]:
    current = db.query(Tournament).filter(Tournament.id == tid).first()
    if not current:
        return [tid]

    current_key = _pair_key(current)
    if not current_key:
        return [tid]

    candidates = db.query(Tournament).all()
    pair_ids = [t.id for t in candidates if _pair_key(t) == current_key and _normalize_gender(t) in {"M", "F"}]

    if not pair_ids:
        return [tid]

    # Keep requested tournament first for stable UX.
    ordered = [tid, *[pid for pid in pair_ids if pid != tid]]
    return list(dict.fromkeys(ordered))
