from typing import Dict, List, Tuple


def _to_minutes(time_str: str) -> int:
    hours, minutes = map(int, time_str.split(":"))
    return hours * 60 + minutes


def _to_time_str(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def generate_slots_for_window(start: str, end: str, duration: int, buffer: int) -> List[Tuple[str, str]]:
    current = _to_minutes(start)
    end_min = _to_minutes(end)
    step = duration + buffer
    slots: List[Tuple[str, str]] = []

    while current + duration <= end_min:
        slots.append((_to_time_str(current), _to_time_str(current + duration)))
        current += step

    return slots


def generate_slots_for_day(windows: List[Dict[str, str]], duration: int, buffer: int) -> List[Dict[str, str]]:
    result: List[Dict[str, str]] = []

    for window in windows:
        raw_slots = generate_slots_for_window(window["start"], window["end"], duration, buffer)
        for start, end in raw_slots:
            result.append({"start_time": start, "end_time": end})

    return result
