import IntegrationsClientPage from '@/app/(dashboard)/dashboard/integrations/integrations-client';
import { caller } from '@/trpc/server';

export default async function IntegrationsPage() {
  const integrations = await caller.integration.getAll();

  return <IntegrationsClientPage initialIntegrations={integrations} />;
}
