from app.solver.penalty_system import PenaltySystem


def test_no_violations_returns_zero() -> None:
    ps = PenaltySystem(weights={"pref_day_violation": 10})
    ps.record("pref_day_violation", 0)
    assert ps.total() == 0


def test_single_violation() -> None:
    ps = PenaltySystem(weights={"pref_day_violation": 10})
    ps.record("pref_day_violation", 3)
    assert ps.total() == 30


def test_multiple_violation_types() -> None:
    ps = PenaltySystem(weights={"pref_day_violation": 10, "consecutive_penalty": 5})
    ps.record("pref_day_violation", 2)
    ps.record("consecutive_penalty", 1)
    assert ps.total() == 25


def test_report_structure() -> None:
    ps = PenaltySystem(weights={"pref_day_violation": 10})
    ps.record("pref_day_violation", 2)
    report = ps.report()
    assert report["pref_day_violation"]["count"] == 2
    assert report["pref_day_violation"]["penalty"] == 20
    assert report["total"] == 20
