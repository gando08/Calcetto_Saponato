import type { Tournament } from "../types";

export type TournamentGender = "M" | "F";

export type TournamentPair = {
  key: string;
  label: string;
  male: Tournament | null;
  female: Tournament | null;
};

const MALE_SUFFIX = /\s*(?:[-_/]|\(|\[)?\s*(?:m|maschile)\s*(?:\)|\])?\s*$/i;
const FEMALE_SUFFIX = /\s*(?:[-_/]|\(|\[)?\s*(?:f|femminile)\s*(?:\)|\])?\s*$/i;
const YEAR_SUFFIX = /\s(20\d{2}|21\d{2})$/;

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function inferGenderFromName(name: string): TournamentGender | null {
  const value = normalizeSpaces(name).toLowerCase();
  if (MALE_SUFFIX.test(value)) return "M";
  if (FEMALE_SUFFIX.test(value)) return "F";
  return null;
}

function normalizeTournamentGender(tournament: Tournament): TournamentGender | null {
  if (tournament.gender === "M" || tournament.gender === "F") {
    return tournament.gender;
  }
  return inferGenderFromName(tournament.name || "");
}

function stripGenderSuffix(name: string) {
  let value = normalizeSpaces(name);
  const previous = value;
  value = value.replace(MALE_SUFFIX, "").replace(FEMALE_SUFFIX, "");
  if (!value) return previous;
  return normalizeSpaces(value);
}

function parseBaseNameAndYear(name: string) {
  const withoutGender = stripGenderSuffix(name);
  const match = withoutGender.match(YEAR_SUFFIX);
  if (!match) {
    return { baseName: withoutGender || name.trim(), year: null };
  }

  const year = Number(match[1]);
  const baseName = normalizeSpaces(withoutGender.slice(0, match.index).trim()) || withoutGender;
  return { baseName, year };
}

function getPairKey(tournament: Tournament) {
  const { baseName, year } = parseBaseNameAndYear(tournament.name || "");
  return `${baseName.toLowerCase()}::${year ?? "none"}`;
}

function getPairLabel(tournament: Tournament) {
  const { baseName, year } = parseBaseNameAndYear(tournament.name || "");
  return year ? `${baseName} ${year}` : baseName;
}

export function buildTournamentPairs(tournaments: Tournament[]): TournamentPair[] {
  const byKey = new Map<string, TournamentPair>();

  for (const tournament of tournaments) {
    const gender = normalizeTournamentGender(tournament);
    if (!gender) continue;

    const key = getPairKey(tournament);
    const existing = byKey.get(key) || {
      key,
      label: getPairLabel(tournament),
      male: null,
      female: null,
    };

    if (gender === "M") existing.male = tournament;
    if (gender === "F") existing.female = tournament;

    byKey.set(key, existing);
  }

  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, "it"));
}

export function getTournamentIdForGender(pair: TournamentPair | null, gender: TournamentGender): string | null {
  if (!pair) return null;
  if (gender === "M") return pair.male?.id || null;
  return pair.female?.id || null;
}

export function buildGenderTournamentName(baseName: string, year: number, gender: TournamentGender) {
  const normalizedBase = normalizeSpaces(baseName || "Torneo Calcetto Saponato");
  return `${normalizedBase} ${year} - ${gender === "M" ? "Maschile" : "Femminile"}`;
}
