from app.services.group_balancing import build_balanced_groups


def test_build_balanced_groups_adds_bye_to_keep_equal_size() -> None:
    team_ids = ["T1", "T2", "T3", "T4", "T5"]
    groups, target_size = build_balanced_groups(team_ids, 2)

    assert target_size == 3
    assert len(groups) == 2
    assert all(len(group) == target_size for group in groups)
    flattened = [item for group in groups for item in group]
    assert len([item for item in flattened if str(item).startswith("BYE::")]) == 1

