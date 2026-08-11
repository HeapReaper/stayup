import LogsClientPage from '@/app/(dashboard)/dashboard/logs/logs-client';
import { caller } from '@/trpc/server';

export default async function LogsPage() {
  const [checks, notifications, auditLogs] = await Promise.all([
    caller.logs.getChecks(),
    caller.logs.getNotifications(),
    caller.logs.getAuditLogs(),
  ]);

  return (
    <LogsClientPage initialChecks={checks} initialNotifications={notifications} initialAuditLogs={auditLogs} />
  );
}
