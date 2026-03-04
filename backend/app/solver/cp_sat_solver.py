import threading
from collections import defaultdict
from typing import Callable, Dict, List, Optional

from ortools.sat.python import cp_model

from app.solver.constraints import check_hard_constraints, compute_soft_penalty


class SolverProgressCallback(cp_model.CpSolverSolutionCallback):
    def __init__(self, on_progress: Callable[[Dict], None]):
        super().__init__()
        self._on_progress = on_progress
        self._solutions = 0

    def on_solution_callback(self) -> None:
        self._solutions += 1
        self._on_progress(
            {
                "type": "solution",
                "solutions_found": self._solutions,
                "objective": self.ObjectiveValue(),
                "best_bound": self.BestObjectiveBound(),
            }
        )


class TournamentScheduler:
    def __init__(
        self,
        config: Dict,
        on_progress: Optional[Callable[[Dict], None]] = None,
        max_time_seconds: int = 30,
    ):
        self.config = config
        self.on_progress = on_progress or (lambda _: None)
        self.max_time_seconds = max_time_seconds
        self._status = "idle"
        self._result: Optional[Dict] = None
        self._thread: Optional[threading.Thread] = None

    def schedule_async(self, matches: List[Dict], slots: List[Dict], teams: List[Dict]) -> None:
        self._thread = threading.Thread(
            target=self._run_solver,
            args=(matches, slots, teams),
            daemon=True,
        )
        self._status = "running"
        self._thread.start()

    def _run_solver(self, matches: List[Dict], slots: List[Dict], teams: List[Dict]) -> None:
        try:
            result = self.solve(matches, slots, teams)
            self._result = result
            self._status = "done"
            self.on_progress({"type": "done", "status": "optimal" if result else "infeasible"})
        except Exception as exc:
            self._status = "error"
            self.on_progress({"type": "error", "message": str(exc)})

    def solve(self, matches: List[Dict], slots: List[Dict], teams: List[Dict]) -> Optional[Dict]:
        model = cp_model.CpModel()
        weights = self.config.get("penalty_weights", {})

        teams_unavail = {team["id"]: set(team.get("unavailable_slot_ids", [])) for team in teams}
        team_prefs = {team["id"]: team for team in teams}

        # ── Variable creation ─────────────────────────────────────────────────
        # A match can only be assigned to a slot from the SAME tournament.
        # Slots without a "tournament_id" key are treated as compatible with all
        # matches (backward-compat for single-tournament scheduling).
        assigned: Dict[tuple[str, str], cp_model.IntVar] = {}
        for match in matches:
            match_tid = match.get("tournament_id")
            for slot in slots:
                slot_tid = slot.get("tournament_id")
                if match_tid and slot_tid and match_tid != slot_tid:
                    continue  # cross-tournament assignment forbidden
                
                is_locked_to_this_slot = match.get("is_manually_locked") and match.get("slot_id") == slot["id"]
                if is_locked_to_this_slot:
                    key = (match["id"], slot["id"])
                    assigned[key] = model.new_bool_var(f"a_{match['id']}_{slot['id']}")
                    model.add(assigned[key] == 1)
                elif not match.get("is_manually_locked"):
                    if check_hard_constraints(match, slot, teams_unavail):
                        key = (match["id"], slot["id"])
                        assigned[key] = model.new_bool_var(f"a_{match['id']}_{slot['id']}")

        # ── Each match gets exactly one slot ──────────────────────────────────
        for match in matches:
            valid_slots = [
                assigned[(match["id"], slot["id"])]
                for slot in slots
                if (match["id"], slot["id"]) in assigned
            ]
            if valid_slots:
                model.add_exactly_one(valid_slots)

        # ── Each slot used by at most one match (within same tournament) ──────
        for slot in slots:
            vars_in_slot = [
                assigned[(match["id"], slot["id"])]
                for match in matches
                if (match["id"], slot["id"]) in assigned
            ]
            if vars_in_slot:
                model.add_at_most_one(vars_in_slot)

        # ── Cross-tournament conflict: same real-world time → at most one match
        # Group slots by (date, start_time); groups with >1 slot span tournaments.
        time_groups: dict[tuple[str, str], list[str]] = defaultdict(list)
        for slot in slots:
            key = (slot.get("date", ""), slot["start_time"])
            time_groups[key].append(slot["id"])

        slot_id_set_cache: dict[tuple[str, str], set[str]] = {
            k: set(v) for k, v in time_groups.items()
        }
        for time_key, slot_ids in time_groups.items():
            if len(slot_ids) < 2:
                continue  # only one tournament has this time slot – already covered above
            slot_set = slot_id_set_cache[time_key]
            cross_vars = [
                assigned[(mid, sid)]
                for (mid, sid) in assigned
                if sid in slot_set
            ]
            if len(cross_vars) > 1:
                model.add_at_most_one(cross_vars)

        # ── Soft penalty objective ─────────────────────────────────────────────
        penalty_terms = []

        # Track team matches per slot for consecutive check
        team_slots_vars = defaultdict(list)
        for (match_id, slot_id), var in assigned.items():
            match = next(m for m in matches if m["id"] == match_id)
            if match.get("team_home_id"):
                team_slots_vars[(match["team_home_id"], slot_id)].append(var)
            if match.get("team_away_id"):
                team_slots_vars[(match["team_away_id"], slot_id)].append(var)

        # Max 2 consecutive matches penalty (3+ is penalized)
        for team in teams:
            tid_str = team["id"]
            for i in range(len(slots) - 2):
                s1, s2, s3 = slots[i]["id"], slots[i+1]["id"], slots[i+2]["id"]
                vars1 = team_slots_vars.get((tid_str, s1), [])
                vars2 = team_slots_vars.get((tid_str, s2), [])
                vars3 = team_slots_vars.get((tid_str, s3), [])
                
                if vars1 and vars2 and vars3:
                    # If team plays in ALL THREE consecutive slots -> Penalty
                    # Each sum is 0 or 1 (at_most_one enforced per slot globally)
                    # triple = 1  iff  sum(vars1) + sum(vars2) + sum(vars3) == 3
                    total = sum(vars1) + sum(vars2) + sum(vars3)
                    triple = model.new_bool_var(f"triple_{tid_str}_{i}")
                    model.add(total == 3).only_enforce_if(triple)
                    model.add(total < 3).only_enforce_if(triple.Not())
                    penalty_terms.append(triple * weights.get("three_consecutive_penalty", 50))

        for match in matches:
            for i, slot in enumerate(slots):
                key = (match["id"], slot["id"])
                if key not in assigned:
                    continue
                penalty = compute_soft_penalty(match, slot, i, len(slots), {}, team_prefs, weights)
                if penalty > 0:
                    penalty_terms.append(assigned[key] * penalty)

        if penalty_terms:
            model.minimize(sum(penalty_terms))

        # ── Solve ─────────────────────────────────────────────────────────────
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.max_time_seconds
        solver.parameters.absolute_gap_limit = 1.0  # stop when within 1 unit of optimal
        solver.parameters.log_search_progress = False

        callback = SolverProgressCallback(self.on_progress)
        status = solver.solve(model, callback)

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            assignment = {}
            for (match_id, slot_id), var in assigned.items():
                if solver.value(var):
                    assignment[match_id] = slot_id
            return {"assignment": assignment, "objective": solver.objective_value}

        return None

    @property
    def status(self) -> str:
        return self._status

    @property
    def result(self) -> Optional[Dict]:
        return self._result
