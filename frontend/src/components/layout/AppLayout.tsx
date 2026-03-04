import type { PropsWithChildren } from "react";

import { Sidebar } from "./Sidebar";

export function AppLayout({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-app-surface">
      <div className="md:flex md:min-h-screen">
        <Sidebar />
        <main className="flex-1 p-4 md:p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
