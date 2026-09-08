// RSS 2.0 and Atom 1.0 feeds of a status page's incidents.
//
// The point of a feed over the e-mail subscription that already exists: it
// needs no address, no confirmation and no unsubscribe — a team drops the URL
// into a Slack/Teams RSS connector or a reader and is done. Both formats,
// because readers and chat connectors are split roughly evenly on which they
// accept, and the two share every line of the query.
import type { PublicIncident, PublicStatusPage } from '@/trpc/routers/statuspage';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The body of one entry: the incident's timeline, newest first, as plain text.
 *
 * Deliberately not HTML — a feed reader that renders HTML and one that shows
 * it raw both cope with plain text, and an incident update is written by
 * whoever is mid-outage, not sanitized for embedding.
 */
function incidentBody(incident: PublicIncident): string {
  const lines = [...incident.updates]
    .reverse()
    .map((update) => `[${update.status}] ${new Date(update.createdAt).toUTCString()}\n${update.message}`);

  if (incident.monitorName) {
    lines.push(`Affected: ${incident.monitorName}`);
  }
  return lines.join('\n\n');
}

/** The instant an entry last changed — what a reader sorts and de-dupes on. */
function lastUpdatedAt(incident: PublicIncident): string {
  const latest = incident.updates[incident.updates.length - 1];
  return latest?.createdAt ?? incident.createdAt;
}

function incidentUrl(baseUrl: string, incident: PublicIncident): string {
  // The status page has no per-incident route, so the fragment is what a
  // reader can usefully link to — and it keeps every entry's id unique.
  return `${baseUrl}#incident-${incident.id}`;
}

export function renderRssFeed(page: PublicStatusPage, baseUrl: string): string {
  const items = page.incidents
    .map(
      (incident) => `    <item>
      <title>[${escapeXml(incident.status)}] ${escapeXml(incident.title)}</title>
      <link>${escapeXml(incidentUrl(baseUrl, incident))}</link>
      <guid isPermaLink="false">${escapeXml(incident.id)}</guid>
      <pubDate>${new Date(lastUpdatedAt(incident)).toUTCString()}</pubDate>
      <category>${escapeXml(incident.impact)}</category>
      <description>${escapeXml(incidentBody(incident))}</description>
    </item>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(page.name)} status</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>${escapeXml(page.description ?? `Incident history for ${page.name}`)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(`${baseUrl}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}

export function renderAtomFeed(page: PublicStatusPage, baseUrl: string): string {
  const updated =
    page.incidents.length > 0
      ? new Date(lastUpdatedAt(page.incidents[0])).toISOString()
      : new Date().toISOString();

  const entries = page.incidents
    .map(
      (incident) => `  <entry>
    <title>[${escapeXml(incident.status)}] ${escapeXml(incident.title)}</title>
    <link href="${escapeXml(incidentUrl(baseUrl, incident))}"/>
    <id>urn:stayup:incident:${escapeXml(incident.id)}</id>
    <updated>${new Date(lastUpdatedAt(incident)).toISOString()}</updated>
    <published>${new Date(incident.createdAt).toISOString()}</published>
    <category term="${escapeXml(incident.impact)}"/>
    <content type="text">${escapeXml(incidentBody(incident))}</content>
  </entry>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(page.name)} status</title>
  <subtitle>${escapeXml(page.description ?? `Incident history for ${page.name}`)}</subtitle>
  <link href="${escapeXml(`${baseUrl}/atom.xml`)}" rel="self"/>
  <link href="${escapeXml(baseUrl)}"/>
  <id>urn:stayup:statuspage:${escapeXml(page.slug)}</id>
  <updated>${updated}</updated>
${entries}
</feed>`;
}
