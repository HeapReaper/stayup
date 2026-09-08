import SettingsClientPage from '@/app/(dashboard)/dashboard/settings/settings-client';
import { caller } from '@/trpc/server';

export default async function SettingsPage() {
  const [settings, updateStatus, me] = await Promise.all([
    caller.settings.get(),
    caller.update.status(),
    caller.user.me(),
  ]);

  return (
    <SettingsClientPage
      initialSettings={settings}
      initialUpdateStatus={updateStatus}
      // Every mutation on this page is Admin-only (src/lib/permissions.ts).
      canWrite={me.capabilities.includes('settings:write')}
    />
  );
}
