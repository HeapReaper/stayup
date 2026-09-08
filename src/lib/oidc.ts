// Optional OIDC / OAuth single sign-on.
//
// Configured entirely from the environment, deliberately — unlike SMTP, which
// lives in AppSettings and is editable on the Settings page. Three reasons
// this one is different: the client secret is a credential that has no
// business round-tripping through a form, better-auth resolves its provider
// list once at `betterAuth()` time (so a change would need a restart anyway),
// and an instance that gets its identity from a company IdP is being deployed
// by whoever writes the compose file, not configured by whoever logs in.
//
// Nothing is registered unless OIDC_CLIENT_ID and an endpoint source are both
// set, so an instance that doesn't want SSO carries no extra surface.

/** Everything the sign-in page needs to render (or not render) the SSO button. */
export interface OidcProviderInfo {
  providerId: string;
  name: string;
}

function env(key: string): string {
  return (process.env[key] ?? '').trim();
}

/**
 * The configured provider, or null when SSO is off.
 *
 * Discovery is the normal path (`OIDC_DISCOVERY_URL`, the
 * .well-known/openid-configuration of the IdP); the explicit endpoint trio is
 * there for providers that don't publish one.
 */
export function oidcConfig() {
  const clientId = env('OIDC_CLIENT_ID');
  const discoveryUrl = env('OIDC_DISCOVERY_URL');
  const authorizationUrl = env('OIDC_AUTHORIZATION_URL');

  if (!clientId || (!discoveryUrl && !authorizationUrl)) return null;

  return {
    providerId: env('OIDC_PROVIDER_ID') || 'oidc',
    name: env('OIDC_PROVIDER_NAME') || 'Single sign-on',
    clientId,
    clientSecret: env('OIDC_CLIENT_SECRET') || undefined,
    discoveryUrl: discoveryUrl || undefined,
    authorizationUrl: authorizationUrl || undefined,
    tokenUrl: env('OIDC_TOKEN_URL') || undefined,
    userInfoUrl: env('OIDC_USERINFO_URL') || undefined,
    // "openid profile email" covers every IdP StayUp needs anything from: a
    // stable subject, a display name and an address to mail.
    scopes: (env('OIDC_SCOPES') || 'openid profile email').split(/[\s,]+/).filter(Boolean),
    /**
     * Whether an IdP account with no StayUp user yet may create one.
     *
     * On by default, because that is the point of wiring up an IdP: the
     * company directory is the invite list. Set OIDC_ALLOW_SIGNUP=false when
     * the IdP is wider than the team — then SSO only signs in accounts an
     * Admin has already created, and everyone else gets a clean rejection
     * rather than a Viewer account nobody asked for.
     */
    allowSignUp: env('OIDC_ALLOW_SIGNUP').toLowerCase() !== 'false',
  };
}

/** What the sign-in page shows, or null when SSO is off. */
export function oidcProviderInfo(): OidcProviderInfo | null {
  const config = oidcConfig();
  if (!config) return null;

  return { providerId: config.providerId, name: config.name };
}
