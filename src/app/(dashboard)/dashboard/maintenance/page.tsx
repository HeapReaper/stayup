import MaintenanceClientPage from '@/app/(dashboard)/dashboard/maintenance/maintenance-client';
import { caller } from '@/trpc/server';

export default async function MaintenancePage() {
  const [windows, monitors] = await Promise.all([
    caller.maintenance.getAll(),
    caller.monitor.getAll(),
  ]);

  return <MaintenanceClientPage initialWindows={windows} monitors={monitors} />;
}
