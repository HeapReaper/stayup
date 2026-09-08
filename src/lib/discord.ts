// Discord delivery. Mirrored by worker/internal/notify/discord.go (invariant 1
// in AGENTS.md) — this file is what the dashboard's "Send test" button and the
// status-page subscriber fan-out use, the Go copy is what real queued alerts
// go through, and an operator must not be able to tell the two apart.
//
// Alerts go out as embeds rather than message text: a webhook post is the one
// place where StayUp gets to show the whole situation at once — which monitor,
// what state, how slow, since when — instead of a sentence someone has to read
// twice at 3am. Everything below is in service of that, including the field
// order (identity, then severity, then measurements).
import { logger } from '@/lib/logging';

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

/**
 * What the alert is about. Every field is optional because the shape has to
 * survive both extremes: a queued incident alert knows all of it, a "Send
 * test" click knows none of it.
 */
export interface AlertContext {
  incidentId?: string | null;
  incidentStatus?: string | null; // Investigating | Identified | Monitoring | Resolved
  incidentImpact?: string | null; // Critical | Major | Minor
  monitorName?: string | null;
  monitorType?: string | null; // HTTP | Ping | Port | DNS
  monitorUrl?: string | null;
  monitorStatus?: string | null; // Up | Down | Degraded
  responseTimeMs?: number | null;
  uptime?: number | null; // percentage over the rolling 30-day window
  lastCheckedAt?: Date | null;
}

// Discord's documented embed limits. Exceeding any one of them makes the whole
// webhook post fail with a 400, which would turn a cosmetic problem (someone
// pasted a 5000-character incident update) into a lost alert — so everything
// is truncated on the way in instead.
const TITLE_LIMIT = 256;
const DESCRIPTION_LIMIT = 4096;
const FIELD_VALUE_LIMIT = 1024;

/**
 * Embed colours, chosen to match how the dashboard already paints these
 * states, so the two read as one product. Resolved/Up is the green from the
 * StayUp mark.
 */
const COLOR_DOWN = 0xed4245;
const COLOR_DEGRADED = 0xf59e0b;
const COLOR_MONITORING = 0x3b82f6;
const COLOR_RESOLVED = 0x3ba55d;
const COLOR_NEUTRAL = 0x99aab5;

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

/**
 * Base URL of this instance, for the "open the incident" link on the embed.
 * BETTER_AUTH_URL is the only thing either runtime knows about its own public
 * origin; the fallback matches the hardcoded default the incident e-mails use.
 */
function dashboardBaseUrl(): string {
  return (process.env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/**
 * Picks the colour from the *incident* status first and the monitor's state
 * second: "Resolved" should be green even while the monitor it belongs to is
 * still catching up, and an incident that's merely being watched shouldn't be
 * as loud as one that's actively down.
 */
export function alertColor(context: AlertContext): number {
  switch (context.incidentStatus) {
    case 'Resolved':
      return COLOR_RESOLVED;
    case 'Monitoring':
      return COLOR_MONITORING;
    case 'Investigating':
    case 'Identified':
      return context.incidentImpact === 'Critical' ? COLOR_DOWN : COLOR_DEGRADED;
  }

  switch (context.monitorStatus) {
    case 'Down':
      return COLOR_DOWN;
    case 'Degraded':
      return COLOR_DEGRADED;
    case 'Up':
      return COLOR_RESOLVED;
    default:
      return COLOR_NEUTRAL;
  }
}

/**
 * Builds the embed for one alert. Fields are omitted rather than filled with
 * "unknown": a test notification carries no monitor, and a Ping monitor has no
 * URL worth printing — an embed of empty rows reads as a bug.
 */
export function buildAlertEmbed(subject: string, message: string, context: AlertContext = {}): DiscordEmbed {
  const fields: DiscordEmbedField[] = [];

  if (context.monitorName) {
    fields.push({
      name: 'Monitor',
      value: truncate(
        context.monitorType ? `${context.monitorName} · ${context.monitorType}` : context.monitorName,
        FIELD_VALUE_LIMIT,
      ),
      inline: true,
    });
  }

  const state = context.incidentStatus ?? context.monitorStatus;
  if (state) fields.push({ name: 'Status', value: state, inline: true });
  if (context.incidentImpact) fields.push({ name: 'Impact', value: context.incidentImpact, inline: true });

  if (context.monitorUrl) {
    // Backticks, not a link: monitor targets are frequently internal hosts,
    // and Discord would try to unfurl anything that looks clickable.
    fields.push({ name: 'Endpoint', value: truncate(`\`${context.monitorUrl}\``, FIELD_VALUE_LIMIT) });
  }

  if (typeof context.responseTimeMs === 'number') {
    fields.push({ name: 'Response time', value: `${context.responseTimeMs} ms`, inline: true });
  }

  if (typeof context.uptime === 'number') {
    fields.push({ name: 'Uptime (30d)', value: `${context.uptime.toFixed(2)}%`, inline: true });
  }

  if (context.lastCheckedAt) {
    // Discord renders <t:unix:R> as a live "3 minutes ago" in the reader's own
    // locale and timezone — worth more on an alert than any string we could
    // format server-side, since AppSettings.timezone doesn't reach Discord.
    const seconds = Math.floor(context.lastCheckedAt.getTime() / 1000);
    fields.push({ name: 'Last check', value: `<t:${seconds}:R>`, inline: true });
  }

  const embed: DiscordEmbed = {
    title: truncate(subject, TITLE_LIMIT),
    description: truncate(message, DESCRIPTION_LIMIT),
    color: alertColor(context),
    footer: { text: 'StayUp' },
    timestamp: new Date().toISOString(),
  };

  if (fields.length > 0) embed.fields = fields;
  if (context.incidentId) embed.url = `${dashboardBaseUrl()}/dashboard/incidents`;

  return embed;
}

/** Posts a payload — an embed, or plain content — to a Discord incoming webhook URL. */
export async function sendDiscordWebhook(webhookUrl: string, payload: DiscordPayload) {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error(`[Discord] Webhook post failed with status ${response.status}`);
      return { success: false };
    }

    return { success: true };
  } catch (error) {
    logger.error(`[Discord] Webhook post failed with error: ${error}`);
    return { success: false, error };
  }
}

/** Convenience wrapper: the embed form of one alert, which is how every caller sends. */
export function sendDiscordAlert(
  webhookUrl: string,
  subject: string,
  message: string,
  context: AlertContext = {},
) {
  return sendDiscordWebhook(webhookUrl, { embeds: [buildAlertEmbed(subject, message, context)] });
}
