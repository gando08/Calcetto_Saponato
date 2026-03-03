import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppLayout } from "./components/layout/AppLayout";
import { Bracket } from "./pages/Bracket";
import { Dashboard } from "./pages/Dashboard";
import { Export } from "./pages/Export";
import { Groups } from "./pages/Groups";
import { Results } from "./pages/Results";
import { Schedule } from "./pages/Schedule";
import { Teams } from "./pages/Teams";
import { TournamentSetup } from "./pages/TournamentSetup";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/setup" element={<TournamentSetup />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/results" element={<Results />} />
            <Route path="/bracket" element={<Bracket />} />
            <Route path="/export" element={<Export />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
