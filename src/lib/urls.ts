/**
 * Where this instance lives, for links that are read outside the browser tab
 * that produced them: alert e-mails, Discord embeds, push notifications.
 *
 * BETTER_AUTH_URL is the only thing either runtime knows about its own public
 * origin — a worker process has no request to infer it from, and the app's own
 * requests arrive with whatever Host a proxy passed along. Mirrored by
 * worker/internal/notify/urls.go (invariant 1 in AGENTS.md); the fallback has
 * to stay the same on both sides, or an unconfigured instance sends two
 * different wrong links depending on who noticed the outage.
 */
const FALLBACK_ORIGIN = 'http://localhost:3000';

/** This instance's public origin, without a trailing slash. */
export function dashboardBaseUrl(): string {
  return (process.env.BETTER_AUTH_URL || FALLBACK_ORIGIN).replace(/\/+$/, '');
}

/** The dashboard's incident list — where every "view incident" link points. */
export function incidentsUrl(): string {
  return `${dashboardBaseUrl()}/dashboard/incidents`;
}
