import OnCallClientPage from '@/app/(dashboard)/dashboard/oncall/oncall-client';
import { caller } from '@/trpc/server';

export default async function OnCallPage() {
  const [schedules, integrations, me] = await Promise.all([
    caller.onCall.getAll(),
    caller.integration.getAll(),
    caller.user.me(),
  ]);

  return (
    <OnCallClientPage
      initialSchedules={schedules}
      integrations={integrations}
      // Rotations decide who gets paged, so they ride with escalation
      // policies: Admin and Member (src/lib/permissions.ts).
      canWrite={me.capabilities.includes('escalations:write')}
    />
  );
}
