import { create } from "zustand";

import type { Tournament } from "../types";

interface TournamentStore {
  current: Tournament | null;
  setCurrent: (t: Tournament | null) => void;
}

export const useTournamentStore = create<TournamentStore>((set) => ({
  current: null,
  setCurrent: (t) => set({ current: t })
}));
