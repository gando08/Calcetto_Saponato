import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000"
});

export const tournamentApi = {
  list: () => api.get("/api/tournaments").then((r) => r.data),
  get: (id: string) => api.get(`/api/tournaments/${id}`).then((r) => r.data),
  create: (data: unknown) => api.post("/api/tournaments", data).then((r) => r.data),
  update: (id: string, data: unknown) => api.put(`/api/tournaments/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/api/tournaments/${id}`),
  addDay: (id: string, data: unknown) => api.post(`/api/tournaments/${id}/days`, data).then((r) => r.data),
  getDays: (id: string) => api.get(`/api/tournaments/${id}/days`).then((r) => r.data),
  replaceDays: (id: string, days: unknown[]) => api.put(`/api/tournaments/${id}/days`, { days }).then((r) => r.data),
  getSlots: (id: string) => api.get(`/api/tournaments/${id}/slots`).then((r) => r.data),
  generateGroups: (id: string) => api.post(`/api/tournaments/${id}/groups/generate`).then((r) => r.data),
  getGroups: (id: string) => api.get(`/api/tournaments/${id}/groups`).then((r) => r.data),
  updateGroupTeams: (id: string, groupId: string, teamIds: string[]) =>
    api.put(`/api/tournaments/${id}/groups/${groupId}/teams`, { team_ids: teamIds }).then((r) => r.data),
  getGroupsCompatibility: (id: string) => api.get(`/api/tournaments/${id}/groups/compatibility`).then((r) => r.data),
  generateSchedule: (id: string, body: { companion_tournament_ids?: string[] } = {}) =>
    api.post(`/api/tournaments/${id}/schedule/generate`, body).then((r) => r.data),
  getSchedule: (id: string) => api.get(`/api/tournaments/${id}/schedule`).then((r) => r.data),
  getScheduleStatus: (id: string) => api.get(`/api/tournaments/${id}/schedule/status`).then((r) => r.data),
  applySchedule: (id: string) => api.post(`/api/tournaments/${id}/schedule/apply`).then((r) => r.data),
  getStandings: (id: string, gender: string) => api.get(`/api/tournaments/${id}/standings/${gender}`).then((r) => r.data),
  getScorers: (id: string, gender?: string) =>
    api.get(`/api/tournaments/${id}/standings/scorers`, { params: { gender } }).then((r) => r.data),
  mergeScorers: (id: string, data: { team_id: string; canonical_name: string; aliases: string[] }) =>
    api.post(`/api/tournaments/${id}/standings/scorers/merge`, data).then((r) => r.data),
  getBracket: (id: string, gender: string) => api.get(`/api/tournaments/${id}/bracket/${gender}`).then((r) => r.data),
  getBracketTeams: (id: string, gender: string) =>
    api.get(`/api/tournaments/${id}/bracket/${gender}/teams`).then((r) => r.data),
  generateBracket: (id: string, gender: string, force = false) =>
    api.post(`/api/tournaments/${id}/bracket/${gender}`, null, { params: { force } }).then((r) => r.data),
  generateBracketManual: (id: string, gender: string, teamIds: string[]) =>
    api.post(`/api/tournaments/${id}/bracket/${gender}/manual`, { team_ids: teamIds }).then((r) => r.data),
  advanceBracket: (id: string, gender: string, matchId: string, winnerTeamId: string) =>
    api.post(`/api/tournaments/${id}/bracket/${gender}/advance`, { match_id: matchId, winner_team_id: winnerTeamId }).then((r) => r.data),
  exportCsv: (id: string, params?: { gender?: "M" | "F"; team_id?: string; day_id?: string }) =>
    api.get(`/api/tournaments/${id}/export/csv`, { responseType: "blob", params }),
  exportPdf: (id: string, params?: { gender?: "M" | "F"; team_id?: string; day_id?: string }) =>
    api.get(`/api/tournaments/${id}/export/pdf`, { responseType: "blob", params }),
  getScheduleQuality: (id: string) => api.get(`/api/tournaments/${id}/schedule/quality`).then((r) => r.data),
};

export const teamApi = {
  list: (tid: string) => api.get(`/api/tournaments/${tid}/teams`).then((r) => r.data),
  create: (tid: string, data: unknown) => api.post(`/api/tournaments/${tid}/teams`, data).then((r) => r.data),
  update: (tid: string, id: string, data: unknown) =>
    api.put(`/api/tournaments/${tid}/teams/${id}`, data).then((r) => r.data),
  delete: (tid: string, id: string) => api.delete(`/api/tournaments/${tid}/teams/${id}`),
  import: (tid: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post(`/api/tournaments/${tid}/teams/import`, fd).then((r) => r.data);
  }
};

export const matchApi = {
  getResult: (mid: string) => api.get(`/api/matches/${mid}/result`).then((r) => r.data),
  setResult: (mid: string, data: unknown) => api.post(`/api/matches/${mid}/result`, data).then((r) => r.data),
  listGoals: (mid: string) => api.get(`/api/matches/${mid}/goals`).then((r) => r.data),
  addGoal: (mid: string, data: unknown) => api.post(`/api/matches/${mid}/goals`, data).then((r) => r.data),
  deleteGoal: (gid: string) => api.delete(`/api/matches/goals/${gid}`)
};

export const scheduleApi = {
  patchMatchSlot: (mid: string, slot_id: string) =>
    api.patch(`/api/matches/${mid}/slot`, { slot_id }).then((r) => r.data),
  patchMatchLock: (mid: string, locked: boolean) =>
    api.patch(`/api/matches/${mid}/lock`, { locked }).then((r) => r.data)
};
