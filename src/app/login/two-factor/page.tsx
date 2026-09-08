import TwoFactorClientPage from '@/app/login/two-factor/two-factor-client';

/**
 * The second half of a sign-in for an account with TOTP enrolled.
 *
 * Reached only from /login, and only after the password was accepted:
 * better-auth has issued a short-lived two-factor cookie rather than a
 * session, and this page trades a 6-digit code (or a backup code) for the
 * real one. Nothing here is behind a session, so there is nothing to fetch —
 * the whole page is the form.
 */
export const dynamic = 'force-dynamic';

interface TwoFactorPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function TwoFactorPage({ searchParams }: TwoFactorPageProps) {
  const { callbackUrl } = await searchParams;

  // Same open-redirect guard as /login: only a relative path this app owns is
  // ever handed back to the client.
  const safeCallbackUrl =
    callbackUrl && /^\/(dashboard|status\/[a-z0-9-]+)$/.test(callbackUrl) ? callbackUrl : '/dashboard';

  return <TwoFactorClientPage callbackUrl={safeCallbackUrl} />;
}
