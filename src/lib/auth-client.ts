import { createAuthClient } from 'better-auth/client';
import { twoFactorClient } from 'better-auth/client/plugins';

/**
 * The twoFactor client plugin is what turns a sign-in that needs a second
 * factor into a redirect instead of a session: better-auth answers
 * `{ twoFactorRedirect: true }` rather than signing the user in, and the
 * caller sends them to /login/two-factor to finish.
 *
 * Handled at the call site (src/app/login/login-client.tsx) rather than
 * through the plugin's own `twoFactorPage` option, because the sign-in page
 * has a callbackUrl to carry across — a hard `window.location.href` would
 * drop it, and a user who came from a protected status page would land on the
 * dashboard instead of where they were going.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
