from typing import Callable, Dict, List, Optional
import threading

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
        max_time_seconds: int = 300,
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

        assigned: Dict[tuple[str, str], cp_model.IntVar] = {}
        for match in matches:
            for slot in slots:
                if not match.get("is_manually_locked"):
                    if check_hard_constraints(match, slot, teams_unavail):
                        key = (match["id"], slot["id"])
                        assigned[key] = model.new_bool_var(f"a_{match['id']}_{slot['id']}")

        for match in matches:
            if match.get("is_manually_locked") and match.get("slot_id"):
                continue
            valid_slots = [
                assigned[(match["id"], slot["id"])]
                for slot in slots
                if (match["id"], slot["id"]) in assigned
            ]
            if valid_slots:
                model.add_exactly_one(valid_slots)

        for slot in slots:
            vars_in_slot = [
                assigned[(match["id"], slot["id"])]
                for match in matches
                if (match["id"], slot["id"]) in assigned
            ]
            if vars_in_slot:
                model.add_at_most_one(vars_in_slot)

        penalty_terms = []
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

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.max_time_seconds
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
