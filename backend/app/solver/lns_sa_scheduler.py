"""
Hybrid CP-SAT + ALNS + Simulated Annealing scheduler.

Pipeline
--------
Phase 1 – CP-SAT  (40 % of budget, default ~12 s)
    Find a high-quality feasible assignment quickly.

Phase 2 – ALNS + SA  (60 % of budget, default ~18 s)
    Iteratively improve via Adaptive Large Neighbourhood Search with a
    Simulated Annealing acceptance criterion.

    Each iteration:
      1. SELECT OPERATOR – choose a destroy operator using roulette-wheel
         selection weighted by historical performance (ALNS).
      2. DESTROY – remove k matches from the current assignment.
      3. REPAIR  – re-assign only the removed matches via a fast CP-SAT
                   sub-solve (all other matches stay fixed → tiny model).
      4. ACCEPT  – SA criterion: always accept improvements;
                   accept degradations with probability exp(-Δ/T).
      5. ADAPT   – every `segment_size` iterations update operator weights
                   based on how well each operator has performed.
      6. REHEAT  – if no improvement for `reheat_patience` iterations,
                   raise temperature by `reheat_factor` to escape local optima.

Destroy operators
-----------------
  random_destroy  – uniform random selection (baseline).
  worst_destroy   – select matches with the highest individual penalty
                    contribution (guided: fix what hurts most).
  team_destroy    – select all matches of the team that currently suffers
                    the most soft-penalty violations (e.g. 3 consecutive).
  cluster_destroy – select matches whose assigned slots are temporally
                    clustered around a randomly chosen pivot slot.

ALNS weight update (per segment)
---------------------------------
  reward per outcome:
    "best"     → σ₁ = 33   (new global best found)
    "better"   → σ₂ =  9   (better than current, not global best)
    "accepted" → σ₃ =  3   (accepted by SA despite being worse)
    "rejected" → σ₄ =  0

  new_weight = decay × old_weight + (1 − decay) × (score / uses)
  weights clipped to a minimum of 0.1 to keep all operators in play.

Temperature initialisation (auto-calibration)
----------------------------------------------
  Run `n_probe` random destroy-repair cycles, collect worsening deltas Δ>0,
  then set T₀ = −mean(Δ) / ln(target_accept_rate)  with target ≈ 0.80.
  This guarantees ~80 % acceptance at start regardless of instance size.

Adaptive destroy rate
---------------------
  After each repair attempt the destroy_rate is nudged:
    repair succeeds → rate × 1.02  (up to max_rate)
    repair fails    → rate × 0.90  (down to min_rate)
  This avoids wasting time on repairs that are systematically infeasible.
"""

import math
import random
import threading
import time
from collections import defaultdict
from typing import Callable, Dict, List, Optional, Tuple

from ortools.sat.python import cp_model

from app.solver.constraints import check_hard_constraints, compute_soft_penalty


# ---------------------------------------------------------------------------
# ALNS operator weight tracker
# ---------------------------------------------------------------------------

class _ALNSWeights:
    """Tracks and updates per-operator performance weights."""

    REWARDS = {"best": 33, "better": 9, "accepted": 3, "rejected": 0}

    def __init__(self, operators: List[str], decay: float = 0.80) -> None:
        self.decay = decay
        self.operators = operators
        self.weights: Dict[str, float] = {op: 1.0 for op in operators}
        self._scores: Dict[str, float] = {op: 0.0 for op in operators}
        self._uses: Dict[str, int] = {op: 0 for op in operators}

    def select(self) -> str:
        total = sum(self.weights.values())
        r = random.random() * total
        cum = 0.0
        for op, w in self.weights.items():
            cum += w
            if r <= cum:
                return op
        return self.operators[0]

    def record(self, operator: str, outcome: str) -> None:
        self._scores[operator] += self.REWARDS[outcome]
        self._uses[operator] += 1

    def adapt(self) -> None:
        for op in self.operators:
            if self._uses[op] > 0:
                perf = self._scores[op] / self._uses[op]
                self.weights[op] = max(
                    0.1,
                    self.decay * self.weights[op] + (1 - self.decay) * perf,
                )
            self._scores[op] = 0.0
            self._uses[op] = 0


# ---------------------------------------------------------------------------
# Main scheduler
# ---------------------------------------------------------------------------

class LNSSAScheduler:
    """
    Drop-in replacement for TournamentScheduler.
    Same constructor / schedule_async / status / result interface.
    """

    _OPERATORS = ["random_destroy", "worst_destroy", "team_destroy", "cluster_destroy"]

    def __init__(
        self,
        config: Dict,
        on_progress: Optional[Callable[[Dict], None]] = None,
        max_time_seconds: int = 30,
    ) -> None:
        self.config = config
        self.on_progress = on_progress or (lambda _: None)
        self.max_time_seconds = max_time_seconds
        self._status = "idle"
        self._result: Optional[Dict] = None
        self._thread: Optional[threading.Thread] = None
        self._cancel = threading.Event()

    # ── Public interface ──────────────────────────────────────────────────

    def schedule_async(
        self, matches: List[Dict], slots: List[Dict], teams: List[Dict]
    ) -> None:
        self._thread = threading.Thread(
            target=self._run, args=(matches, slots, teams), daemon=True
        )
        self._status = "running"
        self._thread.start()

    def cancel(self) -> None:
        self._cancel.set()

    @property
    def status(self) -> str:
        return self._status

    @property
    def result(self) -> Optional[Dict]:
        return self._result

    # ── Orchestration ─────────────────────────────────────────────────────

    def _run(self, matches: List[Dict], slots: List[Dict], teams: List[Dict]) -> None:
        try:
            result = self.solve(matches, slots, teams)
            self._result = result
            self._status = "done"
            self.on_progress(
                {"type": "done", "status": "optimal" if result else "infeasible"}
            )
        except Exception as exc:
            self._status = "error"
            self.on_progress({"type": "error", "message": str(exc)})

    def solve(
        self, matches: List[Dict], slots: List[Dict], teams: List[Dict]
    ) -> Optional[Dict]:
        weights = self.config.get("penalty_weights", {})
        cpsat_budget = max(5, int(self.max_time_seconds * 0.40))
        lns_budget = self.max_time_seconds - cpsat_budget

        teams_unavail = {
            t["id"]: set(t.get("unavailable_slot_ids", [])) for t in teams
        }
        team_prefs = {t["id"]: t for t in teams}
        valid_per_match = self._precompute_valid_slots(matches, slots, teams_unavail)

        # ── Phase 1: CP-SAT ───────────────────────────────────────────────
        self.on_progress(
            {"type": "phase", "phase": 1, "message": "CP-SAT: ricerca soluzione iniziale…"}
        )
        initial = self._cpsat_phase(matches, slots, teams, cpsat_budget)
        if initial is None:
            return None

        self.on_progress(
            {
                "type": "solution",
                "solutions_found": 1,
                "objective": initial["objective"],
                "best_bound": 0,
                "phase": 1,
            }
        )

        # ── Phase 2: ALNS + SA ────────────────────────────────────────────
        self.on_progress(
            {"type": "phase", "phase": 2, "message": "ALNS+SA: ottimizzazione adattiva…"}
        )
        return self._alns_sa_phase(
            initial, matches, slots, team_prefs, weights, valid_per_match, lns_budget
        )

    # ── Phase 1: CP-SAT ───────────────────────────────────────────────────

    def _cpsat_phase(
        self,
        matches: List[Dict],
        slots: List[Dict],
        teams: List[Dict],
        time_limit: int,
    ) -> Optional[Dict]:
        from app.solver.cp_sat_solver import TournamentScheduler

        return TournamentScheduler(
            config=self.config,
            on_progress=self.on_progress,
            max_time_seconds=time_limit,
        ).solve(matches, slots, teams)

    # ── Phase 2: ALNS + SA ────────────────────────────────────────────────

    def _alns_sa_phase(
        self,
        initial: Dict,
        matches: List[Dict],
        slots: List[Dict],
        team_prefs: Dict,
        weights: Dict,
        valid_per_match: Dict[str, List[str]],
        time_budget: int,
    ) -> Dict:
        unlocked = [m for m in matches if not m.get("is_manually_locked")]
        if not unlocked:
            return initial

        # ALNS hyper-parameters
        segment_size: int = int(self.config.get("alns_segment_size", 50))
        alns_decay: float = float(self.config.get("alns_decay", 0.80))

        # Adaptive destroy rate
        destroy_rate = float(self.config.get("lns_destroy_rate", 0.25))
        min_rate, max_rate = 0.10, 0.50

        # Reheat parameters
        reheat_patience: int = int(self.config.get("reheat_patience", 150))
        reheat_factor: float = float(self.config.get("reheat_factor", 1.20))

        slot_by_id = {s["id"]: s for s in slots}
        slot_idx = {s["id"]: i for i, s in enumerate(slots)}

        current = dict(initial["assignment"])
        current_cost = self._total_penalty(current, matches, slots, team_prefs, weights)
        best = dict(current)
        best_cost = current_cost

        # Auto-calibrate initial SA temperature
        temp = self._calibrate_temp(
            current, unlocked, matches, slots, slot_by_id,
            valid_per_match, team_prefs, weights, destroy_rate,
        )

        alns = _ALNSWeights(self._OPERATORS, decay=alns_decay)
        deadline = time.time() + time_budget
        solutions_found = 1
        iteration = 0
        no_improve_streak = 0

        while time.time() < deadline and not self._cancel.is_set():
            # ── Select & destroy ─────────────────────────────────────────
            operator = alns.select()
            k = max(1, int(len(unlocked) * destroy_rate))
            destroyed = self._destroy(operator, k, unlocked, current, matches, slots, slot_idx, weights, team_prefs)

            # ── Repair ───────────────────────────────────────────────────
            remaining = deadline - time.time()
            repair_limit = min(3.0, remaining * 0.35)
            if repair_limit < 0.05:
                break

            repaired = self._repair(
                current, destroyed, slots, slot_by_id,
                team_prefs, weights, valid_per_match, repair_limit,
            )

            if repaired is None:
                # Repair infeasible: shrink destroy rate, penalise operator
                destroy_rate = max(min_rate, destroy_rate * 0.90)
                alns.record(operator, "rejected")
                iteration += 1
                no_improve_streak += 1
            else:
                # ── Evaluate ─────────────────────────────────────────────
                new = {**current, **repaired}
                new_cost = self._total_penalty(new, matches, slots, team_prefs, weights)
                delta = new_cost - current_cost

                # SA acceptance
                accepted = delta < 0 or (
                    temp > 1e-4 and random.random() < math.exp(-delta / temp)
                )

                if accepted:
                    current = new
                    current_cost = new_cost
                    destroy_rate = min(max_rate, destroy_rate * 1.02)

                    if current_cost < best_cost:
                        best = dict(current)
                        best_cost = current_cost
                        solutions_found += 1
                        no_improve_streak = 0
                        alns.record(operator, "best")
                        self.on_progress(
                            {
                                "type": "solution",
                                "solutions_found": solutions_found,
                                "objective": best_cost,
                                "best_bound": 0,
                                "phase": 2,
                                "iteration": iteration,
                                "operator": operator,
                            }
                        )
                    elif delta < 0:
                        no_improve_streak += 1
                        alns.record(operator, "better")
                    else:
                        no_improve_streak += 1
                        alns.record(operator, "accepted")
                else:
                    no_improve_streak += 1
                    alns.record(operator, "rejected")

            # ── SA cooling ────────────────────────────────────────────────
            temp *= float(self.config.get("lns_cooling", 0.97))

            # ── Reheat ───────────────────────────────────────────────────
            # Fix #4: was min(temp*factor, temp*5) — unreachable cap, always
            # resolved to temp*factor regardless. Just multiply directly.
            if no_improve_streak >= reheat_patience:
                temp = temp * reheat_factor
                no_improve_streak = 0

            # ── ALNS adapt ────────────────────────────────────────────────
            if iteration > 0 and iteration % segment_size == 0:
                alns.adapt()

            iteration += 1

        return {"assignment": best, "objective": best_cost}

    # ── Destroy operators ─────────────────────────────────────────────────

    def _destroy(
        self,
        operator: str,
        k: int,
        unlocked: List[Dict],
        current: Dict[str, str],
        matches: List[Dict],
        slots: List[Dict],
        slot_idx: Dict[str, int],
        weights: Dict,
        team_prefs: Dict,
    ) -> List[Dict]:
        if operator == "worst_destroy":
            return self._worst_destroy(k, unlocked, current, matches, slots, slot_idx, weights, team_prefs)
        if operator == "team_destroy":
            return self._team_destroy(k, unlocked, current, matches, slots, slot_idx, weights, team_prefs)
        if operator == "cluster_destroy":
            return self._cluster_destroy(k, unlocked, current, slot_idx)
        # random_destroy (default)
        return random.sample(unlocked, min(k, len(unlocked)))

    def _worst_destroy(
        self,
        k: int,
        unlocked: List[Dict],
        current: Dict[str, str],
        matches: List[Dict],
        slots: List[Dict],
        slot_idx: Dict[str, int],
        weights: Dict,
        team_prefs: Dict,
    ) -> List[Dict]:
        """Select the k matches with the highest individual soft penalty."""
        slot_map = {s["id"]: s for s in slots}
        n = len(slots)

        def match_penalty(m: Dict) -> float:
            sid = current.get(m["id"])
            if not sid or sid not in slot_map:
                return 0.0
            return compute_soft_penalty(
                m, slot_map[sid], slot_idx.get(sid, 0), n, {}, team_prefs, weights
            )

        scored = sorted(unlocked, key=match_penalty, reverse=True)
        # Mix guided (top half) with random to avoid getting stuck
        top = scored[: max(k, len(scored) // 2)]
        return random.sample(top, min(k, len(top)))

    def _team_destroy(
        self,
        k: int,
        unlocked: List[Dict],
        current: Dict[str, str],
        matches: List[Dict],
        slots: List[Dict],
        slot_idx: Dict[str, int],
        weights: Dict,
        team_prefs: Dict,
    ) -> List[Dict]:
        """Select all unlocked matches of the team with the most violations."""
        slot_map = {s["id"]: s for s in slots}
        n = len(slots)
        team_penalties: Dict[str, float] = defaultdict(float)

        for m in unlocked:
            sid = current.get(m["id"])
            if not sid or sid not in slot_map:
                continue
            p = compute_soft_penalty(
                m, slot_map[sid], slot_idx.get(sid, 0), n, {}, team_prefs, weights
            )
            if m.get("team_home_id"):
                team_penalties[m["team_home_id"]] += p
            if m.get("team_away_id"):
                team_penalties[m["team_away_id"]] += p

        if not team_penalties:
            return random.sample(unlocked, min(k, len(unlocked)))

        worst_team = max(team_penalties, key=lambda t: team_penalties[t])
        team_matches = [
            m for m in unlocked
            if m.get("team_home_id") == worst_team or m.get("team_away_id") == worst_team
        ]
        if not team_matches:
            return random.sample(unlocked, min(k, len(unlocked)))
        # Limit to k; pad with random others if team has fewer than k matches
        result = list(team_matches)
        if len(result) > k:
            result = random.sample(result, k)
        elif len(result) < k:
            others = [m for m in unlocked if m not in result]
            result += random.sample(others, min(k - len(result), len(others)))
        return result

    def _cluster_destroy(
        self,
        k: int,
        unlocked: List[Dict],
        current: Dict[str, str],
        slot_idx: Dict[str, int],
    ) -> List[Dict]:
        """Select k matches whose slots are closest to a random pivot slot."""
        assigned = [m for m in unlocked if current.get(m["id"])]
        if not assigned:
            return random.sample(unlocked, min(k, len(unlocked)))

        pivot = random.choice(assigned)
        pivot_idx = slot_idx.get(current.get(pivot["id"], ""), 0)

        scored = sorted(
            assigned,
            key=lambda m: abs(slot_idx.get(current.get(m["id"], ""), 0) - pivot_idx),
        )
        return scored[: k]

    # ── Repair sub-problem ────────────────────────────────────────────────

    def _repair(
        self,
        current: Dict[str, str],
        destroyed: List[Dict],
        slots: List[Dict],
        slot_by_id: Dict,
        team_prefs: Dict,
        weights: Dict,
        valid_per_match: Dict[str, List[str]],
        time_limit: float,
    ) -> Optional[Dict[str, str]]:
        """Re-assign only *destroyed* matches; all others remain fixed."""
        destroyed_ids = {m["id"] for m in destroyed}

        # Slots and time-keys already occupied by fixed matches
        fixed_slots: set = set()
        fixed_times: set = set()
        for mid, sid in current.items():
            if mid not in destroyed_ids:
                fixed_slots.add(sid)
                s = slot_by_id.get(sid)
                if s:
                    fixed_times.add((s.get("date", ""), s["start_time"]))

        # Feasible slots per destroyed match
        avail: Dict[str, List[str]] = {}
        for match in destroyed:
            free = []
            for sid in valid_per_match.get(match["id"], []):
                if sid in fixed_slots:
                    continue
                s = slot_by_id.get(sid)
                if s and (s.get("date", ""), s["start_time"]) in fixed_times:
                    continue
                free.append(sid)
            if not free:
                return None
            avail[match["id"]] = free

        # ── Mini CP-SAT model ─────────────────────────────────────────────
        model = cp_model.CpModel()
        assigned: Dict[Tuple, cp_model.IntVar] = {}
        for match in destroyed:
            for sid in avail[match["id"]]:
                assigned[(match["id"], sid)] = model.new_bool_var(
                    f"r_{match['id'][:6]}_{sid[:6]}"
                )

        # Each match → exactly one slot
        for match in destroyed:
            mvars = [assigned[(match["id"], sid)] for sid in avail[match["id"]]]
            if not mvars:
                return None
            model.add_exactly_one(mvars)

        # Slot uniqueness within the destroyed batch
        by_slot: Dict[str, list] = defaultdict(list)
        for (mid, sid), var in assigned.items():
            by_slot[sid].append(var)
        for var_list in by_slot.values():
            if len(var_list) > 1:
                model.add_at_most_one(var_list)

        # Cross-tournament time conflict within the destroyed batch
        by_time: Dict[tuple, list] = defaultdict(list)
        for (mid, sid), var in assigned.items():
            s = slot_by_id.get(sid)
            if s:
                by_time[(s.get("date", ""), s["start_time"])].append(var)
        for var_list in by_time.values():
            if len(var_list) > 1:
                model.add_at_most_one(var_list)

        # Soft penalty objective
        slot_idx_map = {s["id"]: i for i, s in enumerate(slots)}
        n = len(slots)
        penalty_terms = []
        for match in destroyed:
            for sid in avail[match["id"]]:
                key = (match["id"], sid)
                if key not in assigned:
                    continue
                slot = slot_by_id.get(sid, {"id": sid, "start_time": "", "day_id": ""})
                p = compute_soft_penalty(
                    match, slot, slot_idx_map.get(sid, 0), n, {}, team_prefs, weights
                )
                if p > 0:
                    penalty_terms.append(assigned[key] * p)
        if penalty_terms:
            model.minimize(sum(penalty_terms))

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit
        solver.parameters.log_search_progress = False
        if solver.solve(model) not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None

        result: Dict[str, str] = {}
        for match in destroyed:
            for sid in avail[match["id"]]:
                if assigned.get((match["id"], sid)) and solver.value(
                    assigned[(match["id"], sid)]
                ):
                    result[match["id"]] = sid
                    break

        return result if len(result) == len(destroyed) else None

    # ── Temperature auto-calibration ───────────────────────────────────────

    def _calibrate_temp(
        self,
        current: Dict[str, str],
        unlocked: List[Dict],
        matches: List[Dict],
        slots: List[Dict],
        slot_by_id: Dict,
        valid_per_match: Dict[str, List[str]],
        team_prefs: Dict,
        weights: Dict,
        destroy_rate: float,
        n_probe: int = 40,
        target_rate: float = 0.80,
    ) -> float:
        """
        Set T₀ so that the SA acceptance rate for worsening moves starts at
        ~target_rate.  Uses random destroy-repair probes to sample Δ > 0.
        """
        current_cost = self._total_penalty(current, matches, slots, team_prefs, weights)
        deltas: List[float] = []
        k = max(1, int(len(unlocked) * destroy_rate))

        for _ in range(n_probe):
            destroyed = random.sample(unlocked, min(k, len(unlocked)))
            repaired = self._repair(
                current, destroyed, slots, slot_by_id,
                team_prefs, weights, valid_per_match, time_limit=0.5,
            )
            if repaired is None:
                continue
            new = {**current, **repaired}
            delta = self._total_penalty(new, matches, slots, team_prefs, weights) - current_cost
            if delta > 0:
                deltas.append(delta)

        if not deltas:
            return max(10.0, current_cost * 0.10)

        mean_delta = sum(deltas) / len(deltas)
        return -mean_delta / math.log(target_rate)  # T₀ = -Δ̄ / ln(p₀)

    # ── Penalty evaluation ────────────────────────────────────────────────

    def _total_penalty(
        self,
        assignment: Dict[str, str],
        matches: List[Dict],
        slots: List[Dict],
        team_prefs: Dict,
        weights: Dict,
    ) -> float:
        slot_by_id = {s["id"]: (i, s) for i, s in enumerate(slots)}
        total: float = 0.0
        team_indices: Dict[str, List[int]] = defaultdict(list)

        for match in matches:
            sid = assignment.get(match["id"])
            if not sid:
                continue
            idx, slot = slot_by_id.get(
                sid, (0, {"id": sid, "start_time": "", "day_id": ""})
            )
            total += compute_soft_penalty(
                match, slot, idx, len(slots), {}, team_prefs, weights
            )
            if match.get("team_home_id"):
                team_indices[match["team_home_id"]].append(idx)
            if match.get("team_away_id"):
                team_indices[match["team_away_id"]].append(idx)

        cons_w = weights.get("three_consecutive_penalty", 50)
        for indices in team_indices.values():
            s = sorted(set(indices))
            for i in range(len(s) - 2):
                if s[i + 1] == s[i] + 1 and s[i + 2] == s[i] + 2:
                    total += cons_w

        return total

    # ── Helpers ───────────────────────────────────────────────────────────

    def _precompute_valid_slots(
        self,
        matches: List[Dict],
        slots: List[Dict],
        teams_unavail: Dict[str, set],
    ) -> Dict[str, List[str]]:
        valid: Dict[str, List[str]] = {}
        for match in matches:
            if match.get("is_manually_locked"):
                valid[match["id"]] = (
                    [match["slot_id"]] if match.get("slot_id") else []
                )
                continue
            match_tid = match.get("tournament_id")
            ok: List[str] = []
            for slot in slots:
                slot_tid = slot.get("tournament_id")
                if match_tid and slot_tid and match_tid != slot_tid:
                    continue
                if check_hard_constraints(match, slot, teams_unavail):
                    ok.append(slot["id"])
            valid[match["id"]] = ok
        return valid
