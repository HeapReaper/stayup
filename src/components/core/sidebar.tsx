'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Settings,
  Users,
  BarChart3,
  Sun,
  Moon,
  MonitorCheck,
  Siren,
  StickyNoteCheck,
  Webhook, FileText, Monitor,
  Wrench,
  ChevronsUp,
  CircleArrowUp,
} from 'lucide-react';

import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useTRPC } from '@/trpc/client';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Monitors', href: '/dashboard/monitors', icon: MonitorCheck },
  { name: 'Incidents', href: '/dashboard/incidents', icon: Siren },
  { name: 'Maintenance', href: '/dashboard/maintenance', icon: Wrench },
  { name: 'Status pages', href: '/dashboard/statuspages', icon: StickyNoteCheck },
  { name: 'Integrations', href: '/dashboard/integrations', icon: Webhook },
  { name: 'Escalations', href: '/dashboard/escalations', icon: ChevronsUp },
  { name: 'Users', href: '/dashboard/users', icon: Users },
  { name: 'Logs', href: '/dashboard/logs', icon: FileText },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { setTheme } = useTheme();
  const { state } = useSidebar();
  const isCollapsed: boolean = state === 'collapsed';
  const trpc = useTRPC();

  // Only reads what the last check wrote (src/lib/updates.ts) — the check
  // itself is the janitor's daily job, or the button on the Updates tab. So
  // this can be stale for minutes without ever being wrong, and refetching it
  // on every dashboard navigation would be pure noise.
  const updateStatus = useQuery({
    ...trpc.update.status.queryOptions(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return (
    <ShadcnSidebar collapsible="icon">
      <SidebarHeader className="border-b h-16 flex items-center px-4 justify-between">
        <Link href="/dashboard" className={cn("font-bold text-lg mt-3", isCollapsed && "hidden")}>
          StayUp
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton
                      
                      isActive={isActive}
                      tooltip={item.name}
                    >
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 w-full",
                          isCollapsed && "justify-center"
                        )}
                      >
                        <Icon className="size-4 shrink-0" />

                        {!isCollapsed && (
                          <span className="truncate">
                            {item.name}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-4 flex flex-col gap-3">
        {updateStatus.data?.updateAvailable && (
          <Link
            href="/dashboard/settings"
            title={`${updateStatus.data.latestVersion} is available`}
            className={cn(
              'flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400',
              isCollapsed && 'justify-center px-0',
            )}
          >
            <CircleArrowUp className="size-4 shrink-0" />
            {!isCollapsed && <span className="truncate">Update available</span>}
          </Link>
        )}

        {!isCollapsed && (
          <div className="text-xs text-muted-foreground truncate">
            Ingelogd als gebruiker
          </div>
        )}

        <div className={cn("flex", isCollapsed ? "justify-center" : "justify-end")}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="icon" className="size-9">
                  <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                  <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                  <span className="sr-only">Toggle theme</span>
                </Button>
              }
            />
            <DropdownMenuContent align={isCollapsed ? "center" : "end"}>
              <DropdownMenuItem onClick={() => setTheme('light')}>
                <Sun className="mr-2 h-4 w-4" />
                Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('dark')}>
                <Moon className="mr-2 h-4 w-4" />
                Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('system')}>
                <Monitor className="mr-2 h-4 w-4" />
                System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}