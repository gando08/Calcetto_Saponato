from app.services.slot_generator import generate_slots_for_day, generate_slots_for_window


def test_single_window_no_buffer() -> None:
    slots = generate_slots_for_window("10:00", "12:00", duration=30, buffer=0)
    assert len(slots) == 4
    assert slots[0] == ("10:00", "10:30")
    assert slots[3] == ("11:30", "12:00")


def test_single_window_with_buffer() -> None:
    slots = generate_slots_for_window("10:00", "11:30", duration=30, buffer=5)
    assert len(slots) == 2
    assert slots[0] == ("10:00", "10:30")
    assert slots[1] == ("10:35", "11:05")


def test_window_too_short() -> None:
    slots = generate_slots_for_window("10:00", "10:20", duration=30, buffer=0)
    assert len(slots) == 0


def test_multiple_windows() -> None:
    windows = [{"start": "10:00", "end": "11:00"}, {"start": "15:00", "end": "16:00"}]
    slots = generate_slots_for_day(windows, duration=30, buffer=0)
    assert len(slots) == 4
    assert slots[0]["start_time"] == "10:00"
    assert slots[2]["start_time"] == "15:00"


def test_buffer_does_not_bleed_between_windows() -> None:
    windows = [{"start": "10:00", "end": "10:30"}, {"start": "11:00", "end": "11:30"}]
    slots = generate_slots_for_day(windows, duration=30, buffer=60)
    assert len(slots) == 2
