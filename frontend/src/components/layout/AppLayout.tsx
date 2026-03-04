import type { PropsWithChildren } from "react";

import { Sidebar } from "./Sidebar";

export function AppLayout({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen flex" style={{ background: "var(--sport-bg)" }}>
      <Sidebar />
      <main className="flex-1 overflow-auto min-h-screen">
        <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
