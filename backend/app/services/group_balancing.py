import math

BYE_PREFIX = "BYE::"


def is_bye_team_id(team_id: object) -> bool:
    return isinstance(team_id, str) and team_id.startswith(BYE_PREFIX)


def build_balanced_groups(team_ids: list[str], group_count: int) -> tuple[list[list[str]], int]:
    if not team_ids:
        return [], 0

    safe_group_count = max(1, min(int(group_count or 1), len(team_ids)))
    target_size = math.ceil(len(team_ids) / safe_group_count)

    padded = list(team_ids)
    while len(padded) < safe_group_count * target_size:
        padded.append(f"{BYE_PREFIX}{len(padded)}")

    groups: list[list[str]] = [[] for _ in range(safe_group_count)]
    for idx, team_id in enumerate(padded):
        groups[idx % safe_group_count].append(team_id)

    return groups, target_size

