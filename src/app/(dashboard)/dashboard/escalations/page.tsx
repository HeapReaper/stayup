import EscalationsClientPage from '@/app/(dashboard)/dashboard/escalations/escalations-client';
import { caller } from '@/trpc/server';

export default async function EscalationsPage() {
  const [policies, integrations] = await Promise.all([
    caller.escalationPolicy.getAll(),
    caller.integration.getAll(),
  ]);

  return <EscalationsClientPage initialPolicies={policies} initialIntegrations={integrations} />;
}
