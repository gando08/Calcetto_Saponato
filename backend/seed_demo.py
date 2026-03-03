"""Script per caricare i dati demo nel DB."""

import csv
import json

import requests

BASE = "http://localhost:8000"

with open("data/demo_config.json", encoding="utf-8") as f:
    config = json.load(f)

days = config.pop("days")
resp = requests.post(f"{BASE}/api/tournaments", json=config, timeout=30)
resp.raise_for_status()
tid = resp.json()["id"]
print(f"Torneo creato: {tid}")

for day in days:
    r = requests.post(f"{BASE}/api/tournaments/{tid}/days", json=day, timeout=30)
    r.raise_for_status()
    print(f"  Giorno aggiunto: {day['label']}")

with open("data/demo_teams.csv", encoding="utf-8") as f:
    rows = list(csv.reader(f))
    _ = rows
    req = requests.post(
        f"{BASE}/api/tournaments/{tid}/teams/import",
        files={"file": ("demo_teams.csv", f, "text/csv")},
        timeout=60,
    )
    req.raise_for_status()

print("Squadre importate")
print(f"Demo pronto. Tournament ID: {tid}")
