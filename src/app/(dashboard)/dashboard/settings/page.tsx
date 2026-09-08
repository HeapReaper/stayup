import SettingsClientPage from '@/app/(dashboard)/dashboard/settings/settings-client';
import { caller } from '@/trpc/server';

export default async function SettingsPage() {
  const [settings, updateStatus] = await Promise.all([caller.settings.get(), caller.update.status()]);

  return <SettingsClientPage initialSettings={settings} initialUpdateStatus={updateStatus} />;
}
