// Shared incident lifecycle logic, used by both the `incident` tRPC router
// (manual actions from the dashboard) and src/workers/https.ts (automatic
// incidents opened/updated when a monitor goes Down/Degraded or recovers).
// Keeping this in one place means "post an update" always does the same
// thing — write the timeline entry, roll the status up, notify subscribers —
// no matter who triggered it.
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logging';
import { sendEmail } from '@/lib/email';
import { sendDiscordWebhook } from '@/lib/discord';
import IncidentUpdateEmail from '@/emails/incident-update-email';

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
  });

  logger.info(`[Incidents] Created "${incident.title}" (${incident.impact}) ${incident.id}`);

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
    notifyStatusPageSubscribers(incident.monitorId, incident.title, input.status, input.message),
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
) {
  if (!monitorId) return;

  const links = await prisma.statusPageMonitor.findMany({
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
        jobs.push(() => sendDiscordWebhook(subscriber.target, `**[${status}] ${incidentTitle}**\n${message}`));
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
