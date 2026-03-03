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
  getSlots: (id: string) => api.get(`/api/tournaments/${id}/slots`).then((r) => r.data),
  generateSchedule: (id: string) => api.post(`/api/tournaments/${id}/schedule/generate`).then((r) => r.data),
  getSchedule: (id: string) => api.get(`/api/tournaments/${id}/schedule`).then((r) => r.data),
  getScheduleStatus: (id: string) => api.get(`/api/tournaments/${id}/schedule/status`).then((r) => r.data),
  applySchedule: (id: string) => api.post(`/api/tournaments/${id}/schedule/apply`).then((r) => r.data),
  getStandings: (id: string, gender: string) => api.get(`/api/tournaments/${id}/standings/${gender}`).then((r) => r.data),
  getScorers: (id: string, gender?: string) =>
    api.get(`/api/tournaments/${id}/standings/scorers`, { params: { gender } }).then((r) => r.data),
  exportCsv: (id: string) => api.get(`/api/tournaments/${id}/export/csv`, { responseType: "blob" })
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
  setResult: (mid: string, data: unknown) => api.post(`/api/matches/${mid}/result`, data).then((r) => r.data),
  addGoal: (mid: string, data: unknown) => api.post(`/api/matches/${mid}/goals`, data).then((r) => r.data),
  deleteGoal: (gid: string) => api.delete(`/api/matches/goals/${gid}`)
};
