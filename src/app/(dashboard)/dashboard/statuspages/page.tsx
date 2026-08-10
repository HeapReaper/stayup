import StatusPagesClientPage from '@/app/(dashboard)/dashboard/statuspages/statuspages-client';
import { caller } from '@/trpc/server';

export default async function StatusPagesPage() {
  const [statusPages, monitors] = await Promise.all([
    caller.statusPage.getAll(),
    caller.monitor.getAll(),
  ]);

  return <StatusPagesClientPage initialStatusPages={statusPages} monitors={monitors} />;
}
