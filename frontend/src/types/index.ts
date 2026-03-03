export interface Tournament {
  id: string;
  name: string;
  status: string;
  total_days: number;
  match_duration_minutes: number;
  buffer_minutes: number;
  teams_per_group: number;
  teams_advancing_per_group: number;
  wildcard_enabled: boolean;
  wildcard_count: number;
  points_win: number;
  points_draw: number;
  points_loss: number;
  tiebreaker_order: string[];
  penalty_weights: Record<string, number>;
}

export interface TimeWindow {
  start: string;
  end: string;
}

export interface Team {
  id: string;
  tournament_id: string;
  name: string;
  gender: "M" | "F";
  preferred_days: string[];
  preferred_time_windows: TimeWindow[];
  unavailable_slot_ids: string[];
  prefers_consecutive: boolean;
}

export interface Slot {
  id: string;
  day_id: string;
  day_label: string;
  start_time: string;
  end_time: string;
  is_occupied: boolean;
  is_finals_day: boolean;
}

export interface Match {
  id: string;
  phase: string;
  status: string;
  team_home_id?: string | null;
  team_away_id?: string | null;
  team_home: string;
  team_away: string;
  result?: {
    goals_home: number;
    goals_away: number;
    yellow_home: number;
    yellow_away: number;
  } | null;
  slot: { id: string; start_time: string; end_time: string; day_label: string } | null;
  group_name: string;
  gender: string;
  is_manually_locked: boolean;
}

export interface ScheduleMatchCard {
  id: string;
  status: string;
  is_manually_locked: boolean;
  slot: { id: string; start_time: string; end_time: string; day_label: string } | null;
}

export interface StandingRow {
  team: string;
  team_name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  yellow_cards: number;
}

export interface Scorer {
  player: string;
  team: string;
  team_gender: string;
  goals: number;
}

export interface BracketMatch {
  phase: string;
  round: number;
  gender: string;
  team_home_id?: string | null;
  team_away_id?: string | null;
  placeholder_home: string;
  placeholder_away: string;
  bracket_position: number;
  prerequisite_positions?: number[];
}

export interface GroupTeamSummary {
  id: string;
  name: string;
  gender: string;
}

export interface GroupMatchSummary {
  id: string;
  phase: string;
  round: number;
  status: string;
  team_home_id?: string | null;
  team_away_id?: string | null;
  team_home: string;
  team_away: string;
  slot_id?: string | null;
}

export interface GroupSummary {
  id: string;
  name: string;
  gender: string;
  phase: string;
  teams: GroupTeamSummary[];
  matches: GroupMatchSummary[];
}

export interface CompatibilityBlock {
  teams: Array<{ id: string; name: string }>;
  matrix: Record<string, Record<string, number>>;
}
