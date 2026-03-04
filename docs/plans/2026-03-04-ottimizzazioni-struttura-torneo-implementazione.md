# Ottimizzazioni Struttura Torneo (Approccio A) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allineare qualificazione, wildcard, bracket e scheduling alle regole reali evento (M=8/16 dinamico, F=4 fisso, calendario condiviso campo unico, override manuale con warning).

**Architecture:** Introduciamo servizi backend dedicati per qualificazione/seeding/pairing e rifattorizziamo il router bracket per usarli in modo deterministico e testabile. Sul frontend allineiamo setup, bracket e schedule al modello condiviso M/F, mantenendo editing manuale non bloccante con warning evidenti.

**Tech Stack:** FastAPI, SQLAlchemy, pytest, React 18, TypeScript, TanStack Query, DnD Kit.

---

### Task 1: Test unitari qualificazione e wildcard (RED)

**Files:**
- Create: `backend/tests/test_qualification_service.py`
- Reference: `backend/app/services/standings_calculator.py`

**Step 1: Write failing tests**

```python
def test_direct_qualifiers_take_top_two_per_group(): ...
def test_wildcards_complete_target_size(): ...
def test_wildcard_ranking_skips_head_to_head(): ...
def test_male_target_switches_to_16_when_direct_overflows_8(): ...
def test_female_target_overflow_is_blocked(): ...
def test_generation_requires_closed_group_phase_matches(): ...
```

**Step 2: Run test to verify it fails**

Run: `cd backend && py -3.13 -m pytest tests/test_qualification_service.py -v`  
Expected: FAIL (module/function non esistenti)

**Step 3: Commit**

```bash
git add backend/tests/test_qualification_service.py
git commit -m "test: add qualification and wildcard rule tests"
```

---

### Task 2: Implementare `qualification_service` (GREEN)

**Files:**
- Create: `backend/app/services/qualification_service.py`
- Modify: `backend/app/services/__init__.py`

**Step 1: Implement minimal API**

```python
def compute_target_size(gender: str, direct_count: int) -> tuple[int, list[str]]:
    ...

def validate_group_phase_closed(matches: list[Match]) -> None:
    ...

def build_wildcard_tiebreakers(order: list[str]) -> list[str]:
    return [c for c in order if c != "head_to_head"]

def select_finalists(
    groups: list[Group],
    standings_by_group: dict[str, list[dict]],
    target_size: int,
    wildcard_order: list[str],
) -> dict:
    ...
```

**Step 2: Run test to verify it passes**

Run: `cd backend && py -3.13 -m pytest tests/test_qualification_service.py -v`  
Expected: PASS

**Step 3: Run regression slice**

Run: `cd backend && py -3.13 -m pytest tests/test_standings.py tests/test_groups_router.py -v`  
Expected: PASS

**Step 4: Commit**

```bash
git add backend/app/services/qualification_service.py backend/app/services/__init__.py
git commit -m "feat: add qualification service for direct qualifiers and wildcards"
```

---

### Task 3: Test unitari seeding e vincoli primo turno (RED)

**Files:**
- Create: `backend/tests/test_bracket_rules_service.py`

**Step 1: Write failing tests**

```python
def test_first_round_prefers_first_vs_second_pairings(): ...
def test_first_round_avoids_same_group_clashes(): ...
def test_wildcards_are_seeded_last(): ...
def test_pairing_reports_warning_when_constraints_cannot_all_hold(): ...
```

**Step 2: Run test to verify it fails**

Run: `cd backend && py -3.13 -m pytest tests/test_bracket_rules_service.py -v`  
Expected: FAIL (servizi mancanti)

**Step 3: Commit**

```bash
git add backend/tests/test_bracket_rules_service.py
git commit -m "test: add bracket pairing constraint tests"
```

---

### Task 4: Implementare `seeding_service` e `bracket_rules_service` (GREEN)

**Files:**
- Create: `backend/app/services/seeding_service.py`
- Create: `backend/app/services/bracket_rules_service.py`
- Modify: `backend/app/services/__init__.py`

**Step 1: Implement seeding helpers**

```python
def rank_bucket(rows: list[dict], tiebreakers: list[str]) -> list[dict]: ...
def build_seeded_pool(direct_firsts: list[dict], direct_seconds: list[dict], wildcards: list[dict]) -> list[dict]: ...
```

**Step 2: Implement first-round pairing**

```python
def build_first_round_pairings(seeds: list[dict], bracket_size: int) -> tuple[list[tuple[dict, dict]], list[str]]:
    # prioritizza 1vs2 e no same-group
    ...
```

**Step 3: Run test to verify it passes**

Run: `cd backend && py -3.13 -m pytest tests/test_bracket_rules_service.py -v`  
Expected: PASS

**Step 4: Commit**

```bash
git add backend/app/services/seeding_service.py backend/app/services/bracket_rules_service.py backend/app/services/__init__.py
git commit -m "feat: add seeding and first-round pairing rule services"
```

---

### Task 5: Rifattorizzare `bracket` router sulla nuova logica (TDD)

**Files:**
- Modify: `backend/app/routers/bracket.py`
- Modify: `backend/tests/test_bracket_router.py`
- Optional Create: `backend/tests/test_bracket_generation_rules.py`

**Step 1: Add failing integration tests**

```python
def test_generate_bracket_blocks_if_group_phase_not_closed(): ...
def test_generate_bracket_returns_target_size_and_wildcard_summary(): ...
def test_male_generation_switches_target_to_16_when_directs_overflow_8(): ...
def test_female_generation_blocks_when_directs_exceed_4(): ...
```

**Step 2: Run test to verify it fails**

Run: `cd backend && py -3.13 -m pytest tests/test_bracket_router.py tests/test_bracket_generation_rules.py -v`  
Expected: FAIL

**Step 3: Minimal implementation**

```python
@router.post("/{tid}/bracket/{gender}")
def generate_final_bracket(...):
    # usa qualification_service + seeding_service + bracket_rules_service
    # genera match structure 4/8/16 + third place
    # risponde con warnings e target_size
```

**Step 4: Run tests**

Run: `cd backend && py -3.13 -m pytest tests/test_bracket_router.py tests/test_bracket_generation_rules.py -v`  
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/routers/bracket.py backend/tests/test_bracket_router.py backend/tests/test_bracket_generation_rules.py
git commit -m "feat: enforce finalist selection and target-size bracket generation rules"
```

---

### Task 6: Endpoint override manuale bracket con warning non bloccanti

**Files:**
- Modify: `backend/app/routers/bracket.py`
- Modify: `backend/tests/test_bracket_router.py`

**Step 1: Add failing tests**

```python
def test_manual_bracket_edit_allows_constraint_violation_with_warning(): ...
def test_manual_bracket_edit_updates_match_pairing_and_slot(): ...
```

**Step 2: Run failing tests**

Run: `cd backend && py -3.13 -m pytest tests/test_bracket_router.py -k manual -v`  
Expected: FAIL

**Step 3: Implement endpoint**

```python
@router.patch("/{tid}/bracket/{gender}/matches/{mid}")
def patch_bracket_match(...):
    # update team_home_id/team_away_id/slot_id
    # compute warnings but never block on constraint violation
```

**Step 4: Run tests**

Run: `cd backend && py -3.13 -m pytest tests/test_bracket_router.py -v`  
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app/routers/bracket.py backend/tests/test_bracket_router.py
git commit -m "feat: allow manual bracket overrides with non-blocking warnings"
```

---

### Task 7: Frontend Bracket - warning e metadata target/wildcard

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/pages/Bracket.tsx`

**Step 1: Add API/type contracts**

```ts
type BracketGenerationResponse = {
  target_size: 4 | 8 | 16;
  warnings: string[];
  direct_count: number;
  wildcard_count: number;
  matches: BracketMatch[];
};
```

**Step 2: Render metadata + warnings**

```tsx
<Badge>Target finali: {target_size}</Badge>
{warnings.map(...)}
```

**Step 3: Wire manual edit flow**

```tsx
await tournamentApi.patchBracketMatch(...)
```

**Step 4: Verify build**

Run: `cd frontend && npm run build`  
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/types/index.ts frontend/src/pages/Bracket.tsx
git commit -m "feat: expose bracket target metadata and manual override warnings in UI"
```

---

### Task 8: Setup/Schedule condiviso M-F su campo unico

**Files:**
- Modify: `frontend/src/pages/TournamentSetup.tsx`
- Modify: `frontend/src/pages/Schedule.tsx`
- Modify: `frontend/src/pages/Groups.tsx` (se necessario per coerenza coppia)
- Modify: `frontend/src/utils/tournamentPairs.ts` (se necessario)
- Modify: `backend/app/routers/schedule.py` (solo se serve enforce lato server)
- Modify: `backend/tests/test_tournaments_router.py`
- Modify: `backend/tests/test_schedule_quality.py`

**Step 1: Add failing tests (backend)**

```python
def test_shared_days_replace_keeps_pair_schedule_consistent(): ...
def test_schedule_generation_joint_mode_prevents_cross_tournament_overlap(): ...
```

**Step 2: Run failing tests**

Run: `cd backend && py -3.13 -m pytest tests/test_tournaments_router.py tests/test_schedule_quality.py -v`  
Expected: FAIL

**Step 3: Implement minimal backend enforcement**

```python
# schedule generate: auto include companion tournament in pair mode
# or reject single-mode generation when pair exists
```

**Step 4: Frontend alignment**

```tsx
// Setup: un solo calendario condiviso
// Schedule: no optional companion selector in pair mode
```

**Step 5: Verify**

Run: `cd backend && py -3.13 -m pytest tests -v`  
Expected: PASS

Run: `cd frontend && npm run build`  
Expected: PASS

**Step 6: Commit**

```bash
git add backend/app/routers/schedule.py backend/tests/test_tournaments_router.py backend/tests/test_schedule_quality.py frontend/src/pages/TournamentSetup.tsx frontend/src/pages/Schedule.tsx frontend/src/pages/Groups.tsx frontend/src/utils/tournamentPairs.ts
git commit -m "feat: enforce shared M/F scheduling on single field configuration"
```

---

### Task 9: Regressione completa e documentazione utente

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-03-04-ottimizzazioni-struttura-torneo-design.md` (se allineamenti finali)

**Step 1: Full backend test run**

Run: `cd backend && py -3.13 -m pytest tests -v`  
Expected: PASS

**Step 2: Frontend build**

Run: `cd frontend && npm run build`  
Expected: PASS

**Step 3: Update README**

```md
- target finali per genere
- regole wildcard
- switch automatico M 8->16
- blocco F oltre 4
- override manuale bracket con warning
- scheduling condiviso M/F
```

**Step 4: Commit**

```bash
git add README.md docs/plans/2026-03-04-ottimizzazioni-struttura-torneo-design.md
git commit -m "docs: update tournament rules and shared scheduling workflow"
```
