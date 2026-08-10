import IncidentsClientPage from '@/app/(dashboard)/dashboard/incidents/incidents-client';
import { caller } from '@/trpc/server';

export default async function IncidentsPage() {
  const [incidents, monitors] = await Promise.all([
    caller.incident.getAll(),
    caller.monitor.getAll(),
  ]);

  return <IncidentsClientPage initialIncidents={incidents} monitors={monitors} />;
}
