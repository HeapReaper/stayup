import UsersClientPage from '@/app/(dashboard)/dashboard/users/users-client';
import {caller} from '@/trpc/server';

export default async function UsersPage() {
  const users = await caller.user.getAll();


  return (
    <>
      <UsersClientPage initialUsers={users} />
    </>
  )
}