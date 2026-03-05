# Pair M/F Unified Scheduling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a single-flow M/F tournament experience where schedule generation is always joint, calendar edits are safe and repeatable, female group setup is balanced with BYE handling, and match results are auto-saved.

**Architecture:** Keep the existing two-tournament model (male/female) but make pairing first-class through a backend pair resolver used by schedule/group/result workflows. Persist schedule state only through explicit save endpoints and enforce immutable behavior for `PLAYED` matches at API level. In frontend, remove global gender filters from `Teams`, `Schedule`, and `Results`, merging pair data in one view while preserving gender badges.

**Tech Stack:** FastAPI, SQLAlchemy, OR-Tools CP-SAT, React 18 + TypeScript + TanStack Query, pytest

---

## Implementation Rules

- Follow `@test-driven-development` on every backend behavior change.
- Use `@systematic-debugging` if any test fails unexpectedly.
- Run `@verification-before-completion` before claiming done.
- Keep commits small (one task = one commit).

---

### Task 1: Add Backend Pair Resolver Utility

**Files:**
- Create: `backend/app/services/tournament_pairing.py`
- Test: `backend/tests/test_tournament_pairing.py`

**Step 1: Write the failing test**

```python
from app.services.tournament_pairing import resolve_pair_tournament_ids

def test_resolve_pair_tournament_ids_returns_both_ids(session, seeded_pair):
    male_id, female_id = seeded_pair
    pair = resolve_pair_tournament_ids(male_id, session)
    assert set(pair) == {male_id, female_id}
```

**Step 2: Run test to verify it fails**

Run: `cd backend && py -3.13 -m pytest tests/test_tournament_pairing.py -v`  
Expected: FAIL with `ModuleNotFoundError` or missing function.

**Step 3: Write minimal implementation**

```python
def resolve_pair_tournament_ids(tid: str, db: Session) -> list[str]:
    current = db.query(Tournament).filter(Tournament.id == tid).first()
    if not current:
        return [tid]
    key = _pair_key(current.name, current.gender)
    if not key:
        return [tid]
    candidates = db.query(Tournament).all()
    ids = [t.id for t in candidates if _pair_key(t.name, t.gender) == key]
    return list(dict.fromkeys(ids or [tid]))
```

**Step 4: Run test to verify it passes**

Run: `cd backend && py -3.13 -m pytest tests/test_tournament_pairing.py -v`  
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/app/services/tournament_pairing.py backend/tests/test_tournament_pairing.py
git commit -m "feat: add tournament pair resolver service"
```

---

### Task 2: Make Schedule Generation Pair-Aware by Default

**Files:**
- Modify: `backend/app/routers/schedule.py`
- Modify: `backend/app/services/scheduler.py`
- Modify: `backend/app/api/client.ts` (if backend contract naming changes)
- Test: `backend/tests/test_schedule_pair_generate.py`

**Step 1: Write the failing test**

```python
def test_generate_schedule_uses_companion_automatically(client, seeded_pair, monkeypatch):
    male_id, female_id = seeded_pair
    called = {}
    def fake_start(tid, db, on_progress, companion_tids=None):
        called["tid"] = tid
        called["companions"] = companion_tids or []
    monkeypatch.setattr("app.routers.schedule.start_scheduling", fake_start)
    res = client.post(f"/api/tournaments/{male_id}/schedule/generate", json={})
    assert res.status_code == 200
    assert female_id in called["companions"]
```

**Step 2: Run test to verify it fails**

Run: `cd backend && py -3.13 -m pytest tests/test_schedule_pair_generate.py -v`  
Expected: FAIL because companion is not auto-resolved.

**Step 3: Write minimal implementation**

```python
pair_ids = resolve_pair_tournament_ids(tid, db)
companion_ids = [x for x in pair_ids if x != tid]
start_scheduling(tid, db, on_progress, companion_tids=companion_ids)
```

Also in `scheduler.py`, ensure solver registration includes all pair IDs so `status/save` works from either side.

**Step 4: Run test to verify it passes**

Run: `cd backend && py -3.13 -m pytest tests/test_schedule_pair_generate.py -v`  
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/app/routers/schedule.py backend/app/services/scheduler.py backend/tests/test_schedule_pair_generate.py
git commit -m "feat: auto-generate schedule across M/F pair"
```

---

### Task 3: Add Calendar Save Endpoint and Preserve Editability

**Files:**
- Modify: `backend/app/routers/schedule.py`
- Modify: `backend/app/services/scheduler.py`
- Test: `backend/tests/test_schedule_pair_generate.py`

**Step 1: Write the failing test**

```python
def test_schedule_save_persists_solution(client, seeded_tournament_with_solution):
    tid = seeded_tournament_with_solution
    res = client.post(f"/api/tournaments/{tid}/schedule/save")
    assert res.status_code == 200
    assert res.json()["ok"] is True
```

**Step 2: Run test to verify it fails**

Run: `cd backend && py -3.13 -m pytest tests/test_schedule_pair_generate.py::test_schedule_save_persists_solution -v`  
Expected: FAIL (404 endpoint missing).

**Step 3: Write minimal implementation**

```python
@router.post("/{tid}/schedule/save")
def save_schedule(tid: str, db: Session = Depends(get_db)) -> dict:
    pair_ids = resolve_pair_tournament_ids(tid, db)
    saved = 0
    for pid in pair_ids:
        if apply_solution(pid, db):
            saved += 1
    if saved == 0:
        raise HTTPException(400, "Nessuna soluzione disponibile")
    return {"ok": True, "saved_tournaments": saved}
```

Keep `/schedule/apply` backward-compatible (alias to same save logic).

**Step 4: Run test to verify it passes**

Run: `cd backend && py -3.13 -m pytest tests/test_schedule_pair_generate.py -v`  
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/app/routers/schedule.py backend/app/services/scheduler.py backend/tests/test_schedule_pair_generate.py
git commit -m "feat: add schedule save endpoint with pair persistence"
```

---

### Task 4: Add Unschedule Single/All + PLAYED Guardrails

**Files:**
- Modify: `backend/app/routers/schedule.py`
- Test: `backend/tests/test_schedule_manual_editing.py`

**Step 1: Write the failing tests**

```python
def test_unschedule_single_sets_match_pending_and_frees_slot(client, seeded_match):
    mid = seeded_match["scheduled_match_id"]
    res = client.patch(f"/api/matches/{mid}/unschedule")
    assert res.status_code == 200

def test_unschedule_rejects_played_match(client, seeded_match):
    mid = seeded_match["played_match_id"]
    res = client.patch(f"/api/matches/{mid}/unschedule")
    assert res.status_code == 400
```

Add similar test for:
- `POST /api/tournaments/{tid}/schedule/unschedule-all`
- `PATCH /api/matches/{mid}/slot` and `PATCH /api/matches/{mid}/lock` rejecting `PLAYED`.

**Step 2: Run test to verify it fails**

Run: `cd backend && py -3.13 -m pytest tests/test_schedule_manual_editing.py -v`  
Expected: FAIL for missing endpoint/guard.

**Step 3: Write minimal implementation**

```python
if match.status == MatchStatus.PLAYED:
    raise HTTPException(400, "Partita già giocata: modifica non consentita")
```

```python
@manual_router.patch("/{mid}/unschedule")
def unschedule_match(mid: str, db: Session = Depends(get_db)) -> dict:
    ...
    match.slot_id = None
    match.is_manually_locked = False
    match.status = MatchStatus.PENDING
```

```python
@router.post("/{tid}/schedule/unschedule-all")
def unschedule_all(tid: str, db: Session = Depends(get_db)) -> dict:
    ...
```

**Step 4: Run test to verify it passes**

Run: `cd backend && py -3.13 -m pytest tests/test_schedule_manual_editing.py -v`  
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/app/routers/schedule.py backend/tests/test_schedule_manual_editing.py
git commit -m "feat: add unschedule endpoints and protect played matches"
```

---

### Task 5: Implement Female Balanced Groups with BYE Padding

**Files:**
- Create: `backend/app/services/group_balancing.py`
- Modify: `backend/app/routers/groups.py`
- Test: `backend/tests/test_group_balancing.py`
- Modify: `backend/tests/test_groups_router.py`

**Step 1: Write the failing test**

```python
from app.services.group_balancing import build_balanced_groups

def test_build_balanced_groups_adds_bye_to_keep_equal_size():
    groups, target_size = build_balanced_groups(["t1","t2","t3","t4","t5"], 2)
    assert target_size == 3
    assert len(groups) == 2
    assert all(len(g) == 3 for g in groups)  # includes BYE token
```

Add router test with 5 female teams asserting successful generation and no invalid matches with both teams null.

**Step 2: Run test to verify it fails**

Run: `cd backend && py -3.13 -m pytest tests/test_group_balancing.py tests/test_groups_router.py -v`  
Expected: FAIL (module/helper missing).

**Step 3: Write minimal implementation**

```python
def build_balanced_groups(team_ids: list[str], group_count: int) -> tuple[list[list[str]], int]:
    target_size = math.ceil(len(team_ids) / group_count)
    padded = [*team_ids]
    while len(padded) < group_count * target_size:
        padded.append(f"BYE::{len(padded)}")
    ...
```

In `groups.py`, when generating matches:

```python
for home_id, away_id in generate_round_robin(group_slots):
    if str(home_id).startswith("BYE::") or str(away_id).startswith("BYE::"):
        continue
    db.add(Match(...))
```

**Step 4: Run test to verify it passes**

Run: `cd backend && py -3.13 -m pytest tests/test_group_balancing.py tests/test_groups_router.py -v`  
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/app/services/group_balancing.py backend/app/routers/groups.py backend/tests/test_group_balancing.py backend/tests/test_groups_router.py
git commit -m "feat: enforce balanced female groups with BYE padding"
```

---

### Task 6: Update Frontend API Contracts for New Calendar Actions

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types/index.ts`

**Step 1: Add failing usage call sites**

In `Schedule.tsx`, call planned methods `scheduleApi.unscheduleMatch`, `tournamentApi.unscheduleAll`, `tournamentApi.saveSchedule` before defining them in client.

**Step 2: Run build to verify it fails**

Run: `cd frontend && npm run build`  
Expected: FAIL with TypeScript errors for missing client methods.

**Step 3: Write minimal implementation**

```ts
saveSchedule: (id: string) => api.post(`/api/tournaments/${id}/schedule/save`).then((r) => r.data),
unscheduleAll: (id: string) => api.post(`/api/tournaments/${id}/schedule/unschedule-all`).then((r) => r.data),
```

```ts
unscheduleMatch: (mid: string) => api.patch(`/api/matches/${mid}/unschedule`).then((r) => r.data),
```

**Step 4: Run build to verify it passes**

Run: `cd frontend && npm run build`  
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/types/index.ts
git commit -m "feat: add frontend API bindings for save and unschedule actions"
```

---

### Task 7: Refactor Schedule UI to Single Pair View and New Actions

**Files:**
- Modify: `frontend/src/pages/Schedule.tsx`
- Modify: `frontend/src/utils/tournamentPairs.ts` (labels and helper reuse if needed)

**Step 1: Write failing behavior checks**

Use a manual checklist in PR description:
- no `Pianifica insieme a` control
- no primary M/F toggle in schedule controls
- buttons visible: `Genera calendario`, `Annulla selezionata`, `Annulla tutte`, `Salva calendario`
- played match cannot be moved/unscheduled.

**Step 2: Run build to capture current breakage**

Run: `cd frontend && npm run build`  
Expected: PASS before refactor (baseline).

**Step 3: Implement minimal UI/logic**

Key code direction:

```ts
const pairIds = [selectedPair?.male?.id, selectedPair?.female?.id].filter(Boolean) as string[];
// fetch schedules for both ids and merge
// remove primaryGender + companionTids states
// map actions to unschedule single/all/save endpoints
```

Add local action buttons:
- per-match `Annulla` (if `status !== "played"`)
- global `Annulla tutte`
- `Salva calendario`

**Step 4: Verify**

Run:
- `cd frontend && npm run build`
- manual smoke: generate -> unschedule one -> save -> refresh -> state persisted.

Expected: build PASS + checklist satisfied.

**Step 5: Commit**

```bash
git add frontend/src/pages/Schedule.tsx frontend/src/utils/tournamentPairs.ts
git commit -m "feat: unify M/F schedule view and add unschedule/save controls"
```

---

### Task 8: Remove Gender Filter from Teams View

**Files:**
- Modify: `frontend/src/pages/Teams.tsx`

**Step 1: Write failing behavior checks**

Manual check target:
- no global gender filter buttons (`Tutti/M/F`) in top controls.
- list shows all teams in selected edition.
- create/edit still assigns correct tournament by team gender.

**Step 2: Build baseline**

Run: `cd frontend && npm run build`  
Expected: PASS before edits.

**Step 3: Implement minimal refactor**

```ts
// remove genderFilter state and filteredTeams memo
const visibleTeams = teams;
```

Keep gender badges and counts in summary chips.

**Step 4: Verify**

Run:
- `cd frontend && npm run build`
- manual smoke in UI for add/edit/import.

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/pages/Teams.tsx
git commit -m "refactor: remove global gender filter from teams page"
```

---

### Task 9: Refactor Results View + Add Debounced Autosave

**Files:**
- Modify: `frontend/src/pages/Results.tsx`

**Step 1: Write failing behavior checks**

Manual targets:
- no M/F toggle in results controls.
- standings/results visible for pair edition in one screen.
- editing goals/fouls triggers autosave within debounce window.

**Step 2: Build baseline**

Run: `cd frontend && npm run build`  
Expected: PASS before refactor.

**Step 3: Implement minimal logic**

Core changes:

```ts
const pairIds = [selectedPair?.male?.id, selectedPair?.female?.id].filter(Boolean) as string[];
// fetch schedules/standings/scorers for both tournaments and merge per section
```

Debounced autosave:

```ts
useEffect(() => {
  const t = setTimeout(() => {
    void matchApi.setResult(matchId, draft);
  }, 800);
  return () => clearTimeout(t);
}, [draft, matchId]);
```

Guard against duplicate payload submissions (cache last sent draft per match).

**Step 4: Verify**

Run:
- `cd frontend && npm run build`
- manual smoke: edit result, wait >800ms, reload, confirm persisted values.

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/pages/Results.tsx
git commit -m "feat: unify results view and add debounced autosave"
```

---

### Task 10: End-to-End Verification, Regression, and Docs

**Files:**
- Modify: `docs/manuale-utente-webapp.md`
- Modify: `docs/plans/2026-03-05-implementazione.md` (optional progress log section)

**Step 1: Run focused backend tests**

Run:
- `cd backend && py -3.13 -m pytest tests/test_tournament_pairing.py tests/test_schedule_pair_generate.py tests/test_schedule_manual_editing.py tests/test_group_balancing.py tests/test_groups_router.py tests/test_results_router.py -v`

Expected: PASS.

**Step 2: Run full backend test suite**

Run: `cd backend && py -3.13 -m pytest tests -v`  
Expected: PASS.

**Step 3: Run frontend verification**

Run: `cd frontend && npm run build`  
Expected: PASS.

**Step 4: Update user docs**

Add sections:
- calendario senza filtro genere;
- generazione sempre congiunta;
- annulla singola/tutte + salva calendario;
- autosave risultati.

**Step 5: Commit**

```bash
git add docs/manuale-utente-webapp.md docs/plans/2026-03-05-implementazione.md
git commit -m "docs: update manual for unified M/F scheduling flow"
```

---

## Final Verification Checklist

- `PLAYED` matches are immutable from schedule APIs.
- `Generate` handles pair M/F without manual companion selection.
- `Save calendar` persists while preserving future editability.
- Female groups remain balanced through virtual BYE slots.
- Teams/Schedule/Results no longer expose global gender filters.
- Results/fouls autosave persists after refresh/crash recovery window.

