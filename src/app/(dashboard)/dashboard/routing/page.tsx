import RoutingClientPage from '@/app/(dashboard)/dashboard/routing/routing-client';
import { caller } from '@/trpc/server';

export default async function RoutingPage() {
  const [rules, integrations, monitors, tags, me] = await Promise.all([
    caller.notificationRule.getAll(),
    caller.integration.getAll(),
    caller.monitor.getAll(),
    caller.tag.getAll(),
    caller.user.me(),
  ]);

  return (
    <RoutingClientPage
      initialRules={rules}
      integrations={integrations}
      monitors={monitors}
      tags={tags}
      canWrite={me.capabilities.includes('integrations:write')}
    />
  );
}
