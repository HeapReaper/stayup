import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import SignInClientPage from '@/app/login/login-client';

// Without this, Next's static analysis sees a plain data fetch with no
// request-varying input and may prerender the page once at build time —
export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const existingUserCount = await prisma.user.count();
  const existingUser: boolean = existingUserCount > 0;

  const { callbackUrl } = await searchParams;
  // Only ever hand the client a relative /status/... path back — anything
  // else (an absolute URL, a dashboard path, etc.) is ignored so this can't
  // be used as an open redirect.
  const safeCallbackUrl = callbackUrl && /^\/status\/[a-z0-9-]+$/.test(callbackUrl) ? callbackUrl : null;

  return <SignInClientPage existingUser={existingUser} callbackUrl={safeCallbackUrl} />;
}
