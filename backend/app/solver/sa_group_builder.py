"""
Simulated Annealing + LNS + Iterated Local Search for group formation.

Key design constraint
---------------------
Teams in the same group MUST be able to play against each other, i.e. every
pair must share at least one available slot.  The cost function enforces this
with a large infeasibility penalty so that even during SA exploration the
solver is strongly steered away from unschedulable groups.

Cost function
-------------
  cost(groups) = -Σ overlap(a,b)          ← maximise pairwise compatibility
               + INFEASIBLE_PENALTY
                 × |{pairs with overlap == 0}|   ← forbid unschedulable matches

  overlap(a,b) = |available_a ∩ available_b| / |all_slots|   ∈ [0, 1]

INFEASIBLE_PENALTY is set to (n_slots + 1) so that a single infeasible pair
always costs more than the maximum possible gain from all other compatible
pairs combined.

Algorithm
---------
Outer loop (ILS — Iterated Local Search):
  for restart in range(max_restarts):
      run SA from current best (with temperature reduced each restart)
      if SA found improvement → update global best
      apply perturbation (double LNS reconstruct) to escape local optimum

Inner loop (SA):
  for iteration in range(max_iter):
      with probability 0.60 → SWAP      (exchange 1 team between 2 groups)
      with probability 0.25 → RECONSTRUCT (LNS on 2 groups, greedy repair)
      with probability 0.15 → ROTATE    (3-group cyclic rotation)
      apply SA acceptance: always accept if Δ<0; else accept with exp(-Δ/T)
      cool temperature: T ← T × cooling

Temperature initialisation (auto-calibration):
  Sample `n_probe` random moves, compute mean |Δ|, set T₀ so that the
  initial acceptance probability for an average-bad move is ~80 %:
      T₀ = -mean_delta / ln(0.80)
"""

import copy
import math
import random
from typing import Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Standalone overlap helper (no external imports – avoids circular deps)
# ---------------------------------------------------------------------------

def _overlap(team_a: Dict, team_b: Dict, all_slots: List[str]) -> float:
    if not all_slots:
        return 1.0
    unavail_a = set(team_a.get("unavailable_slot_ids", []))
    unavail_b = set(team_b.get("unavailable_slot_ids", []))
    avail_a = set(all_slots) - unavail_a
    avail_b = set(all_slots) - unavail_b
    return len(avail_a & avail_b) / len(all_slots)


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------

class SAGroupBuilder:
    """
    Build tournament groups via SA + LNS + ILS.

    All hyper-parameters have sensible defaults that work well for typical
    tournament sizes (8–32 teams, 2–8 groups).  They can be overridden by
    passing keyword arguments to build_groups().
    """

    def build_groups(
        self,
        teams: List[Dict],
        teams_per_group: int,
        all_slot_ids: List[str],
        # SA inner loop
        max_iter: int = 5_000,
        cooling: float = 0.995,
        # ILS outer loop
        max_restarts: int = 4,
        restart_temp_decay: float = 0.5,
        # auto-calibration
        n_probe: int = 80,
        target_accept_rate: float = 0.80,
    ) -> List[List[Dict]]:
        if not teams:
            return []

        n_slots = len(all_slot_ids)
        # Large enough that one infeasible pair always outweighs all gains
        infeasible_penalty = float(n_slots + 1)

        # Pre-compute pairwise compatibility matrix once
        compat = self._build_compat(teams, all_slot_ids)

        # Warm start: greedy "most-constrained-first"
        groups = self._greedy_init(teams, teams_per_group, compat)
        current_cost = self._cost(groups, compat, infeasible_penalty)
        best = copy.deepcopy(groups)
        best_cost = current_cost

        # Auto-calibrate initial temperature
        initial_temp = self._calibrate_temp(
            groups, compat, infeasible_penalty, n_probe, target_accept_rate
        )
        temp = initial_temp

        # ── ILS outer loop ────────────────────────────────────────────────
        for restart in range(max_restarts):
            groups, current_cost, temp = self._sa_loop(
                groups, current_cost, temp, cooling, max_iter,
                compat, infeasible_penalty, teams_per_group,
            )
            if current_cost < best_cost:
                best = copy.deepcopy(groups)
                best_cost = current_cost

            if restart < max_restarts - 1:
                # Perturbation: double LNS reconstruct to escape local optimum
                groups = self._perturb(groups, compat, teams_per_group)
                current_cost = self._cost(groups, compat, infeasible_penalty)
                # Restart with reduced temperature (partial re-annealing)
                temp = initial_temp * (restart_temp_decay ** (restart + 1))

        return best

    # ── SA inner loop ──────────────────────────────────────────────────────

    def _sa_loop(
        self,
        groups: List[List[Dict]],
        current_cost: float,
        temp: float,
        cooling: float,
        max_iter: int,
        compat: Dict,
        infeasible_penalty: float,
        teams_per_group: int,
    ) -> Tuple[List[List[Dict]], float, float]:
        for _ in range(max_iter):
            r = random.random()
            if r < 0.60:
                neighbor = self._swap_move(groups)
            elif r < 0.85:
                neighbor = self._reconstruct_move(groups, compat, teams_per_group)
            else:
                neighbor = self._rotate_move(groups)

            new_cost = self._cost(neighbor, compat, infeasible_penalty)
            delta = new_cost - current_cost

            if delta < 0 or (
                temp > 1e-6 and random.random() < math.exp(-delta / temp)
            ):
                groups = neighbor
                current_cost = new_cost

            temp *= cooling

        return groups, current_cost, temp

    # ── Cost function ──────────────────────────────────────────────────────

    def _cost(
        self,
        groups: List[List[Dict]],
        compat: Dict,
        infeasible_penalty: float,
    ) -> float:
        total = 0.0
        for group in groups:
            for i, a in enumerate(group):
                for b in group[i + 1 :]:
                    ov = compat.get(a["id"], {}).get(b["id"], 0.0)
                    if ov == 0.0:
                        total += infeasible_penalty  # unschedulable pair
                    else:
                        total -= ov                  # maximise compatibility
        return total

    # ── Neighbourhood moves ────────────────────────────────────────────────

    def _swap_move(self, groups: List[List[Dict]]) -> List[List[Dict]]:
        """Exchange one team between two different groups (sizes preserved)."""
        if len(groups) < 2:
            return copy.deepcopy(groups)
        g1, g2 = random.sample(range(len(groups)), 2)
        if not groups[g1] or not groups[g2]:
            return copy.deepcopy(groups)
        new = copy.deepcopy(groups)
        i = random.randrange(len(new[g1]))
        j = random.randrange(len(new[g2]))
        new[g1][i], new[g2][j] = new[g2][j], new[g1][i]
        return new

    def _reconstruct_move(
        self,
        groups: List[List[Dict]],
        compat: Dict,
        teams_per_group: int,
    ) -> List[List[Dict]]:
        """LNS: pool two groups, rebuild both greedily (sizes preserved)."""
        if len(groups) < 2:
            return copy.deepcopy(groups)
        g1, g2 = random.sample(range(len(groups)), 2)
        size1, size2 = len(groups[g1]), len(groups[g2])
        pool = list(groups[g1]) + list(groups[g2])
        new = copy.deepcopy(groups)
        new[g1], new[g2] = [], []

        # Most-constrained first
        pool_sorted = sorted(
            pool,
            key=lambda t: len(t.get("unavailable_slot_ids", [])),
            reverse=True,
        )
        caps = {g1: size1, g2: size2}
        for team in pool_sorted:
            best_g, best_score = g1, -float("inf")
            for gi, cap in caps.items():
                if len(new[gi]) >= cap:
                    continue
                grp = new[gi]
                score = (
                    sum(compat.get(team["id"], {}).get(m["id"], 0.0) for m in grp)
                    / len(grp)
                    if grp
                    else 0.5
                )
                if score > best_score:
                    best_score, best_g = score, gi
            new[best_g].append(team)
        return new

    def _rotate_move(self, groups: List[List[Dict]]) -> List[List[Dict]]:
        """3-group cyclic rotation: one team from each group moves to the next."""
        if len(groups) < 3:
            return self._swap_move(groups)
        g1, g2, g3 = random.sample(range(len(groups)), 3)
        if not groups[g1] or not groups[g2] or not groups[g3]:
            return self._swap_move(groups)
        new = copy.deepcopy(groups)
        i = random.randrange(len(new[g1]))
        j = random.randrange(len(new[g2]))
        k = random.randrange(len(new[g3]))
        # Cyclic: g1→g2, g2→g3, g3→g1
        new[g2][j], new[g3][k], new[g1][i] = new[g1][i], new[g2][j], new[g3][k]
        return new

    # ── ILS perturbation ───────────────────────────────────────────────────

    def _perturb(
        self,
        groups: List[List[Dict]],
        compat: Dict,
        teams_per_group: int,
    ) -> List[List[Dict]]:
        """Large perturbation: apply reconstruct twice on different group pairs."""
        result = self._reconstruct_move(groups, compat, teams_per_group)
        if len(result) >= 2:
            result = self._reconstruct_move(result, compat, teams_per_group)
        return result

    # ── Temperature auto-calibration ───────────────────────────────────────

    def _calibrate_temp(
        self,
        groups: List[List[Dict]],
        compat: Dict,
        infeasible_penalty: float,
        n_probe: int,
        target_rate: float,
    ) -> float:
        """
        Estimate T₀ so that the initial SA acceptance rate for worsening moves
        is approximately `target_rate`.

        Strategy: sample `n_probe` random swap/reconstruct moves, collect the
        positive deltas (worsening moves), then solve:
            target_rate = exp(-mean_delta / T₀)  →  T₀ = -mean_delta / ln(target_rate)
        """
        deltas: List[float] = []
        current_cost = self._cost(groups, compat, infeasible_penalty)
        # Use only swap moves for speed
        for _ in range(n_probe):
            neighbor = self._swap_move(groups)
            new_cost = self._cost(neighbor, compat, infeasible_penalty)
            delta = new_cost - current_cost
            if delta > 0:
                deltas.append(delta)

        if not deltas:
            return 10.0  # already near-optimal

        mean_delta = sum(deltas) / len(deltas)
        # T₀ = -mean_delta / ln(target_rate)
        return -mean_delta / math.log(target_rate)

    # ── Initialisation helpers ─────────────────────────────────────────────

    def _greedy_init(
        self,
        teams: List[Dict],
        teams_per_group: int,
        compat: Dict,
    ) -> List[List[Dict]]:
        n_groups = math.ceil(len(teams) / teams_per_group)
        groups: List[List[Dict]] = [[] for _ in range(n_groups)]
        sorted_teams = sorted(
            teams,
            key=lambda t: len(t.get("unavailable_slot_ids", [])),
            reverse=True,
        )
        for team in sorted_teams:
            best_g, best_score = 0, -1.0
            found_slot = False
            for i, group in enumerate(groups):
                if len(group) >= teams_per_group:
                    continue
                found_slot = True
                score = (
                    sum(compat[team["id"]].get(m["id"], 0.0) for m in group)
                    / len(group)
                    if group
                    else 0.5
                )
                if score > best_score:
                    best_score, best_g = score, i
            # Fix #9: if all groups are at capacity (non-divisible team count),
            # fall back to the least-full group rather than silently overflowing
            # group 0.
            if not found_slot:
                best_g = min(range(len(groups)), key=lambda i: len(groups[i]))
            groups[best_g].append(team)
        return [g for g in groups if g]

    def _build_compat(
        self, teams: List[Dict], all_slot_ids: List[str]
    ) -> Dict[str, Dict[str, float]]:
        return {
            a["id"]: {
                b["id"]: _overlap(a, b, all_slot_ids)
                for b in teams
                if b["id"] != a["id"]
            }
            for a in teams
        }
