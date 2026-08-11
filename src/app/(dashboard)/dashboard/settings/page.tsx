import SettingsClientPage from '@/app/(dashboard)/dashboard/settings/settings-client';
import { caller } from '@/trpc/server';

export default async function SettingsPage() {
  const settings = await caller.settings.get();

  return <SettingsClientPage initialSettings={settings} />;
}
