import MonitorsClientPage from '@/app/(dashboard)/dashboard/monitors/monitor-client';
import { caller } from '@/trpc/server';

export default async function MonitorsPage() {
  const monitors = await caller.monitor.getAll();

  return <MonitorsClientPage initialMonitors={monitors} />;
}
