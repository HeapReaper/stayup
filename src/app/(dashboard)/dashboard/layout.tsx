import Sidebar from '@/components/core/sidebar';
import React from 'react';
import {SidebarProvider, SidebarTrigger} from '@/components/ui/sidebar';
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <SidebarProvider>
        <Sidebar />

        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <header className="h-16 border-b flex items-center px-4 bg-background gap-2 shrink-0">
            <SidebarTrigger />
            <h1 className="text-sm font-medium text-muted-foreground">Dashboard</h1>
          </header>

          {/* Every dashboard page's content is capped here rather than in the
              pages themselves: tables and charts stretched across an
              ultrawide monitor are unreadable, and one container means a new
              page can't forget to do it. `max-w-7xl` matches what the
              dashboard home page constrained itself to before this moved up.
              The padding stays on <main> so the background still fills the
              viewport. */}
          <main className="flex-1 p-6 bg-muted/20">
            <div className="mx-auto w-full max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </SidebarProvider>
    </div>
  );
}