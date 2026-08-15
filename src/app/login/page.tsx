import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import SignInClientPage from '@/app/login/login-client';

// Without this, Next's static analysis sees a plain data fetch with no
// request-varying input and may prerender the page once at build time —
// which would freeze the "does a user already exist?" check forever at
// whatever it was during `next build`, defeating the whole gate.
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const existingUserCount = await prisma.user.count();
  const existingUser: boolean = existingUserCount > 0;


  return <SignInClientPage existingUser={existingUser} />;
}
