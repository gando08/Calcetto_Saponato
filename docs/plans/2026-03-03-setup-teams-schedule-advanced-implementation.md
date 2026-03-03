# Setup, Squadre e Calendario Avanzato Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rendere operativo il flusso `Setup -> Squadre -> Calendario` con UI avanzata, drag&drop, lock/unlock e persistenza immediata.

**Architecture:** Backend FastAPI esteso con endpoint atomici per lock e riassegnazione slot; frontend React con stato ottimistico, rollback su errore e sincronizzazione dati via React Query.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic v2, React 18 + TypeScript + React Query + DnD Kit

---

### Task 1: API Backend per editing manuale calendario (test-first)

**Files:**
- Create: `backend/tests/test_schedule_manual_editing.py`
- Modify: `backend/app/routers/schedule.py`

**Step 1: Write failing tests**

```python
# backend/tests/test_schedule_manual_editing.py
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_patch_match_slot_returns_404_for_missing_match():
    res = client.patch("/api/matches/missing/slot", json={"slot_id": "x"})
    assert res.status_code == 404

def test_patch_match_lock_returns_404_for_missing_match():
    res = client.patch("/api/matches/missing/lock", json={"locked": True})
    assert res.status_code == 404
```

**Step 2: Run test to confirm RED**

Run: `cd backend && python -m pytest tests/test_schedule_manual_editing.py -v`  
Expected: FAIL (404 route not found or import errors)

**Step 3: Implement minimal router endpoints**

```python
@router.patch("/matches/{mid}/slot")
def reassign_match_slot(...):
    # validate match exists
    # validate slot exists and not occupied
    # clear previous slot occupation
    # set new slot and commit

@router.patch("/matches/{mid}/lock")
def set_match_lock(...):
    # toggle is_manually_locked and commit
```

**Step 4: Run tests to confirm GREEN**

Run: `python -m pytest tests/test_schedule_manual_editing.py -v`  
Expected: PASS

**Step 5: Commit**

```bash
git add backend/tests/test_schedule_manual_editing.py backend/app/routers/schedule.py
git commit -m "feat: add manual schedule edit endpoints"
```

---

### Task 2: Frontend API contracts for manual editing

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types/index.ts`

**Step 1: Extend API client**

```ts
export const scheduleApi = {
  patchMatchSlot: (mid: string, slot_id: string) =>
    api.patch(`/api/matches/${mid}/slot`, { slot_id }).then(r => r.data),
  patchMatchLock: (mid: string, locked: boolean) =>
    api.patch(`/api/matches/${mid}/lock`, { locked }).then(r => r.data),
};
```

**Step 2: Add schedule view models**

```ts
export interface ScheduleMatchCard {
  id: string;
  status: string;
  is_manually_locked: boolean;
  slot: { id: string; start_time: string; end_time: string; day_label: string } | null;
}
```

**Step 3: Verify build**

Run: `cd frontend && npm run build`  
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/types/index.ts
git commit -m "feat: add frontend API bindings for manual schedule editing"
```

---

### Task 3: TournamentSetup page (wizard operativo)

**Files:**
- Modify: `frontend/src/pages/TournamentSetup.tsx`
- Optional create: `frontend/src/components/tournament/SetupWizard.tsx`

**Step 1: Build minimal 4-step wizard**

```tsx
const [step, setStep] = useState(0);
// step 0: name + base config
// step 1: points/tiebreakers
// step 2: days + windows
// step 3: summary + submit
```

**Step 2: Persist with APIs**

```tsx
// on submit:
const t = await tournamentApi.create(payloadTournament);
for (const day of days) await tournamentApi.addDay(t.id, day);
```

**Step 3: Error + loading handling**

```tsx
if (isSaving) disable buttons;
if (error) render banner in italian;
```

**Step 4: Verify build**

Run: `npm run build`  
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/pages/TournamentSetup.tsx frontend/src/components/tournament/
git commit -m "feat: implement tournament setup wizard"
```

---

### Task 4: Teams page (CRUD + import + preferenze)

**Files:**
- Modify: `frontend/src/pages/Teams.tsx`
- Optional create: `frontend/src/components/tournament/TeamEditorDrawer.tsx`

**Step 1: Render teams table and filters**

```tsx
const { data: teams } = useQuery({ queryKey: ["teams", tid], queryFn: () => teamApi.list(tid) });
```

**Step 2: Add create/update/delete mutations**

```tsx
const createTeam = useMutation({ mutationFn: (payload) => teamApi.create(tid, payload) });
```

**Step 3: Add CSV import**

```tsx
await teamApi.import(tid, file);
queryClient.invalidateQueries({ queryKey: ["teams", tid] });
```

**Step 4: Add preferences drawer**

```tsx
// preferred_days, preferred_time_windows, unavailable_slot_ids, prefers_consecutive
```

**Step 5: Verify build**

Run: `npm run build`  
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/pages/Teams.tsx frontend/src/components/tournament/
git commit -m "feat: implement teams management with import and preferences"
```

---

### Task 5: Schedule page avanzata con drag&drop e lock

**Files:**
- Modify: `frontend/src/pages/Schedule.tsx`
- Optional create: `frontend/src/components/schedule/DayScheduleBoard.tsx`
- Optional create: `frontend/src/components/schedule/MatchCard.tsx`

**Step 1: Show schedule + slots grouped by day**

```tsx
const { data: schedule } = useQuery({ queryKey: ["schedule", tid], queryFn: () => tournamentApi.getSchedule(tid) });
```

**Step 2: Connect solver actions**

```tsx
await tournamentApi.generateSchedule(tid);
await tournamentApi.applySchedule(tid);
```

**Step 3: Implement DnD optimistic move**

```tsx
onDragEnd => local optimistic update;
await scheduleApi.patchMatchSlot(matchId, slotId);
onError => rollback previous state;
```

**Step 4: Implement lock toggle**

```tsx
await scheduleApi.patchMatchLock(matchId, !locked);
invalidateQueries(["schedule", tid]);
```

**Step 5: Wire WebSocket progress**

```tsx
const ws = new WebSocket(`${baseWs}/api/tournaments/ws/${tid}/solver`);
ws.onmessage = (ev) => setSolverProgress(JSON.parse(ev.data));
```

**Step 6: Verify build**

Run: `npm run build`  
Expected: PASS

**Step 7: Commit**

```bash
git add frontend/src/pages/Schedule.tsx frontend/src/components/schedule/
git commit -m "feat: implement advanced schedule board with drag drop and lock"
```

---

### Task 6: End-to-end smoke verification for this increment

**Files:**
- Modify if needed: `README.md` (section usage operativo)

**Step 1: Backend tests**

Run: `cd backend && python -m pytest tests -v`  
Expected: PASS

**Step 2: Frontend build**

Run: `cd frontend && npm run build`  
Expected: PASS

**Step 3: Manual smoke (local)**

Run backend + frontend, verify:
1. create tournament from setup
2. create/import team
3. generate/apply schedule
4. drag/drop match and lock/unlock

**Step 4: Commit final polish**

```bash
git add README.md
git commit -m "docs: update usage for setup teams schedule workflow"
```
