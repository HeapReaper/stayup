// Incident lifecycle logic for the dashboard: the `incident` tRPC router's
// manual actions (create/update/resolve/acknowledge). Automatic incidents —
// opened/updated when a monitor goes Down/Degraded or recovers, and
// escalation paging — are handled by the Go workers instead
// (worker/internal/incidents), a behaviorally-equivalent port of this same
// lifecycle so a manual dashboard action and an automatic one produce
// identical incident/timeline/notification records.
//
// Notification routing (mirrored on the Go side): a monitor without an
// EscalationPolicy gets the default behavior — every incident/update
// broadcasts to every enabled Integration (queueIntegrationDeliveries). A
// monitor *with* one instead has its incidents paged through that policy's
// ordered steps (EscalateOverdueIncidents, polled from
// worker/cmd/integrations), stopping once acknowledgeIncident() is called or
// the incident resolves. See notifyOrEscalate() for where that fork happens.
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logging';
import { sendEmail } from '@/lib/email';
import { sendDiscordAlert, type AlertContext } from '@/lib/discord';
import IncidentUpdateEmail from '@/emails/incident-update-email';
import { getSettings } from '@/lib/settings';
import { decideRouting, type RoutingDecision } from '@/lib/notification-rules';

export const incidentImpactEnum = z.enum(['Critical', 'Major', 'Minor']);
export const incidentStatusEnum = z.enum(['Investigating', 'Identified', 'Monitoring', 'Resolved']);

export type IncidentImpact = z.infer<typeof incidentImpactEnum>;
export type IncidentStatus = z.infer<typeof incidentStatusEnum>;

// Deliberately not importing the `Monitor`/`Incident` model types from
// `@prisma/client` here — these functions only ever touch a couple of fields,
// so a minimal local shape is enough and keeps this file decoupled from the
// generated client's type exports (callers pass full Prisma rows, which
// satisfy these structurally).
interface MonitorRef {
  id: string;
  name: string;
}

interface IncidentNotifyContext {
  id: string;
  title: string;
  monitor: { name: string } | null;
}

// The monitor fields an alert can describe. Every one is optional: callers
// pass whole Prisma rows (which satisfy this structurally), but a monitor
// that has never been checked has no response time, and a Ping monitor has
// nothing URL-shaped to show.
interface AlertMonitorRef {
  name: string;
  type?: string;
  url?: string;
  status?: string;
  responseTime?: number | null;
  uptime?: number;
  lastCheckedAt?: Date | null;
}

/**
 * Assembles what a Discord embed shows next to the message — see
 * buildAlertEmbed() in src/lib/discord.ts. Kept here (rather than inside the
 * delivery code) because this is the only layer that still holds the incident
 * and monitor rows; by the time a queued delivery is picked up, the Go worker
 * re-reads the same fields with a join.
 */
function buildAlertContext(
  incident: { id: string; impact?: string },
  status: string,
  monitor: AlertMonitorRef | null,
): AlertContext {
  return {
    incidentId: incident.id,
    incidentStatus: status,
    incidentImpact: incident.impact ?? null,
    monitorName: monitor?.name ?? null,
    monitorType: monitor?.type ?? null,
    monitorUrl: monitor?.url ?? null,
    monitorStatus: monitor?.status ?? null,
    responseTimeMs: monitor?.responseTime ?? null,
    uptime: monitor?.uptime ?? null,
    lastCheckedAt: monitor?.lastCheckedAt ?? null,
  };
}

interface CreateIncidentInput {
  title: string;
  impact: IncidentImpact;
  message: string;
  monitorId?: string | null;
  createdById?: string | null;
}

/** Creates an incident plus its first timeline entry (status: Investigating). */
export async function createIncident(input: CreateIncidentInput) {
  const incident = await prisma.incident.create({
    data: {
      title: input.title,
      impact: input.impact,
      status: 'Investigating',
      monitorId: input.monitorId ?? null,
      createdById: input.createdById ?? null,
      updates: {
        create: {
          status: 'Investigating',
          message: input.message,
          authorId: input.createdById ?? null,
        },
      },
    },
    include: { monitor: true },
  });

  logger.info(`[Incidents] Created "${incident.title}" (${incident.impact}) ${incident.id}`);

  await Promise.all([
    notifyStatusPageSubscribers(
      incident.monitorId,
      incident.title,
      incident.status,
      input.message,
      buildAlertContext(incident, incident.status, incident.monitor),
    ),
    notifyOrEscalate(incident, incident.status, input.message),
  ]);

  return incident;
}

interface PostUpdateInput {
  incidentId: string;
  status: IncidentStatus;
  message: string;
  authorId?: string | null;
}

/** Appends a timeline entry to an incident, rolls its status forward, and notifies subscribers. */
export async function postIncidentUpdate(input: PostUpdateInput) {
  const incident = await prisma.incident.update({
    where: { id: input.incidentId },
    data: {
      status: input.status,
      resolvedAt: input.status === 'Resolved' ? new Date() : undefined,
      updates: {
        create: {
          status: input.status,
          message: input.message,
          authorId: input.authorId ?? null,
        },
      },
    },
    include: { monitor: true },
  });

  logger.info(`[Incidents] ${incident.id} -> ${input.status}: ${input.message}`);

  await Promise.all([
    notifySubscribers(incident, input.status, input.message),
    notifyStatusPageSubscribers(
      incident.monitorId,
      incident.title,
      input.status,
      input.message,
      buildAlertContext(incident, input.status, incident.monitor),
    ),
    notifyOrEscalate(incident, input.status, input.message),
  ]);

  return incident;
}

/** Convenience wrapper around postIncidentUpdate for the common "Resolved" case. */
export function resolveIncident(incidentId: string, message: string, authorId?: string | null) {
  return postIncidentUpdate({ incidentId, status: 'Resolved', message, authorId });
}

async function notifySubscribers(
  incident: IncidentNotifyContext,
  status: string,
  message: string,
) {
  const subscribers = await prisma.incidentSubscriber.findMany({
    where: { incidentId: incident.id },
  });

  if (subscribers.length === 0) return;

  const results = await Promise.allSettled(
    subscribers.map((subscriber) =>
      sendEmail({
        to: subscriber.email,
        subject: `[${status}] ${incident.title}`,
        react: IncidentUpdateEmail({
          incidentTitle: incident.title,
          status,
          message,
          monitorName: incident.monitor?.name,
        }),
      }),
    ),
  );

  const failed = results.filter((r) => r.status === 'rejected').length;
  logger.info(
    `[Incidents] Notified ${subscribers.length - failed}/${subscribers.length} subscriber(s) for ${incident.id}`,
  );
}

/**
 * Notifies everyone subscribed to a status page that includes this monitor
 * (StatusPageSubscriber — subscribed to the whole page, distinct from
 * IncidentSubscriber which is scoped to one incident). A monitor can appear
 * on more than one published status page; subscribers are de-duped by
 * (channel, target) so nobody is pinged twice for the same update.
 */
async function notifyStatusPageSubscribers(
  monitorId: string | null,
  incidentTitle: string,
  status: string,
  message: string,
  context: AlertContext = {},
) {
  if (!monitorId) return;

  const links = await prisma.statusPageComponent.findMany({
    where: { monitorId, statusPage: { isPublished: true } },
    include: { statusPage: { include: { subscribers: true } } },
  });

  const seen = new Set<string>();
  const jobs: Array<() => Promise<unknown>> = [];

  for (const link of links) {
    for (const subscriber of link.statusPage.subscribers) {
      const key = `${subscriber.channel}:${subscriber.target}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (subscriber.channel === 'Discord') {
        jobs.push(() => sendDiscordAlert(subscriber.target, `[${status}] ${incidentTitle}`, message, context));
      } else {
        jobs.push(() =>
          sendEmail({
            to: subscriber.target,
            subject: `[${status}] ${incidentTitle}`,
            react: IncidentUpdateEmail({ incidentTitle, status, message }),
          }),
        );
      }
    }
  }

  if (jobs.length === 0) return;

  const results = await Promise.allSettled(jobs.map((job) => job()));
  const failed = results.filter((r) => r.status === 'rejected').length;
  logger.info(
    `[Incidents] Notified ${jobs.length - failed}/${jobs.length} status page subscriber(s) for monitor ${monitorId}`,
  );
}

/**
 * Queues one IntegrationDelivery row per enabled Integration (Discord, Slack,
 * Webhook, Telegram, Email, PagerDuty). Actual delivery happens asynchronously
 * in the Go integrations worker (worker/cmd/integrations), so a slow/
 * unreachable webhook never blocks this call — that's also what gives
 * deliveries retries on failure.
 */
async function queueIntegrationDeliveries(
  incidentId: string,
  incidentTitle: string,
  status: string,
  message: string,
  integrationIds?: string[],
) {
  const integrations = await prisma.integration.findMany({
    where: { enabled: true, ...(integrationIds ? { id: { in: integrationIds } } : {}) },
  });
  if (integrations.length === 0) return;

  await prisma.integrationDelivery.createMany({
    data: integrations.map((integration) => ({
      integrationId: integration.id,
      incidentId,
      event: 'Incident Alert',
      message: `[${status}] ${incidentTitle}: ${message}`,
    })),
  });

  logger.info(`[Incidents] Queued ${integrations.length} integration deliver${integrations.length === 1 ? 'y' : 'ies'} for ${incidentId}`);
}

/**
 * Evaluates the NotificationRule list against this incident. Mirrors
 * routeFor() in worker/internal/incidents — the dashboard's manual incident
 * actions route through here and the workers' automatic ones through there,
 * so the same incident has to reach the same people either way.
 */
async function routeFor(incident: {
  id: string;
  impact?: string;
  monitorId: string | null;
}): Promise<RoutingDecision> {
  const rules = await prisma.notificationRule.findMany({
    where: { enabled: true },
    orderBy: { order: 'asc' },
    include: { integrations: { include: { integration: { select: { enabled: true } } } } },
  });
  if (rules.length === 0) return { kind: 'Broadcast' };

  const settings = await getSettings();

  const monitorTagIds = incident.monitorId
    ? (await prisma.monitorTag.findMany({ where: { monitorId: incident.monitorId }, select: { tagId: true } })).map(
        (row) => row.tagId,
      )
    : [];

  return decideRouting(
    rules.map((rule) => ({
      ...rule,
      // A disabled integration would otherwise make a Route rule look like it
      // delivered — same filter the Go store applies in its join.
      integrationIds: rule.integrations.filter((link) => link.integration.enabled).map((link) => link.integrationId),
    })),
    { monitorId: incident.monitorId, monitorTagIds, impact: incident.impact ?? null },
    new Date(),
    settings.timezone,
  );
}

/**
 * Routes an incident's Integration notification: the normal broadcast to
 * every enabled Integration, unless the incident's monitor has an
 * EscalationPolicy attached — in which case the broadcast is skipped
 * entirely and EscalateOverdueIncidents (called on a timer from the Go
 * worker/cmd/integrations binary) pages the policy's steps in order instead,
 * stopping as soon as someone acknowledges the incident.
 */
async function notifyOrEscalate(
  incident: {
    id: string;
    title: string;
    impact?: string;
    monitorId: string | null;
    monitor: { escalationPolicyId: string | null } | null;
  },
  status: string,
  message: string,
) {
  if (incident.monitor?.escalationPolicyId) {
    logger.info(
      `[Incidents] ${incident.id} is on an escalation policy — skipping the Integration broadcast, escalation steps will page instead`,
    );
    return;
  }

  let decision: RoutingDecision;
  try {
    decision = await routeFor(incident);
  } catch (error) {
    // A rule that can't be read must not silence an alert — falling back to
    // the broadcast is the safe direction to fail in.
    logger.error(`[Incidents] Could not evaluate notification rules for ${incident.id} — broadcasting: ${error}`);
    decision = { kind: 'Broadcast' };
  }

  if (decision.kind === 'Suppress') {
    logger.info(`[Incidents] ${incident.id} not notified: ${decision.reason}`);
    return;
  }

  if (decision.kind === 'Route') {
    if (decision.integrationIds.length === 0) {
      logger.warn(
        `[Incidents] Rule "${decision.rule.name}" matched ${incident.id} but has no enabled integrations — nobody was notified`,
      );
      return;
    }
    logger.info(
      `[Incidents] ${incident.id} routed by rule "${decision.rule.name}" to ${decision.integrationIds.length} integration(s)`,
    );
    await queueIntegrationDeliveries(incident.id, incident.title, status, message, decision.integrationIds);
    return;
  }

  await queueIntegrationDeliveries(incident.id, incident.title, status, message);
}

// escalateOverdueIncidents() used to live here, polled from
// src/workers/integrations.ts. That worker is now the Go binary built from
// worker/cmd/integrations, which pages escalation steps itself
// (worker/internal/incidents's EscalateOverdueIncidents) — nothing in the
// Next.js app calls this anymore, so it was removed rather than kept as dead
// code. See that Go package for the current implementation.

/** Acknowledges an incident, halting any further escalation-policy paging. Idempotent. */
export async function acknowledgeIncident(incidentId: string, userId: string) {
  const existing = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!existing) return null;
  if (existing.acknowledgedAt) return existing;

  const incident = await prisma.incident.update({
    where: { id: incidentId },
    data: { acknowledgedAt: new Date(), acknowledgedById: userId },
  });

  logger.info(`[Incidents] ${incident.id} acknowledged by ${userId}`);

  return incident;
}

/**
 * Called by monitor-check workers when a monitor is found Down/Degraded.
 * Opens a new incident unless one is already open for that monitor, so
 * repeated failing checks don't spam duplicate incidents.
 */
export async function ensureIncidentForMonitor(
  monitor: MonitorRef,
  status: 'Down' | 'Degraded',
  message: string,
) {
  const existing = await prisma.incident.findFirst({
    where: { monitorId: monitor.id, status: { not: 'Resolved' } },
  });

  if (existing) return existing;

  const impact: IncidentImpact = status === 'Down' ? 'Critical' : 'Minor';
  const verb = status === 'Down' ? 'is down' : 'is degraded';

  return createIncident({
    title: `${monitor.name} ${verb}`,
    impact,
    message,
    monitorId: monitor.id,
    createdById: null,
  });
}

/**
 * Called by monitor-check workers when a previously failing monitor recovers.
 * Moves any open incident for it to "Monitoring" — a human still confirms the
 * final "Resolved" from the dashboard.
 */
export async function noteMonitorRecovered(monitor: MonitorRef) {
  const existing = await prisma.incident.findFirst({
    where: { monitorId: monitor.id, status: { not: 'Resolved' } },
  });

  if (!existing || existing.status === 'Monitoring') return null;

  return postIncidentUpdate({
    incidentId: existing.id,
    status: 'Monitoring',
    message: `${monitor.name} has recovered and is responding normally. Continuing to monitor for stability.`,
    authorId: null,
  });
}
