import UsersClientPage from '@/app/(dashboard)/dashboard/users/users-client';
import { caller } from '@/trpc/server';

export default async function UsersPage() {
  const [users, me] = await Promise.all([caller.user.getAll(), caller.user.me()]);

  return (
    <UsersClientPage
      initialUsers={users}
      // Inviting, editing and deleting accounts is Admin-only
      // (src/lib/permissions.ts). The routers enforce it either way; this
      // only keeps the buttons from being offered to someone who'd get a
      // FORBIDDEN back.
      canManageUsers={me.capabilities.includes('users:manage')}
    />
  );
}
