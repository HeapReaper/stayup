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

          <main className="flex-1 p-6 bg-muted/20">
            {children}
          </main>
        </div>
      </SidebarProvider>
    </div>
  );
}