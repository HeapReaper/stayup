// Announcing maintenance windows.
//
// A MaintenanceWindow used to be a purely inward-facing thing: it suppressed
// incidents and drew a box on the status page, and nobody was ever told about
// it. So subscribers heard about every outage and nothing about the planned
// work — which is backwards, since the planned work is the half somebody can
// actually schedule around.
//
// Four announcements, split across the two runtimes by which one is awake
// when the transition happens:
//
//   Scheduled / Cancelled — a person did it, so the dashboard sends it (here).
//   Started / Ended       — a clock did it, so the integrations worker sends
//                           it (worker/internal/maintenance/notify.go).
//
// Both halves must produce the same wording, which is why
// buildAnnouncement() is mirrored line for line on the Go side (invariant 1
// in AGENTS.md).
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logging';
import { sendEmail } from '@/lib/email';
import { sendDiscordAlert } from '@/lib/discord';
import { dashboardBaseUrl } from '@/lib/urls';
import MaintenanceEmail from '@/emails/maintenance-email';

export const MAINTENANCE_PHASES = ['Scheduled', 'Started', 'Ended', 'Cancelled'] as const;
export type MaintenancePhase = (typeof MAINTENANCE_PHASES)[number];

/** The IntegrationDelivery.event value every maintenance announcement carries. */
export const MAINTENANCE_EVENT = 'Maintenance Notice';

const PHASE_LABELS: Record<MaintenancePhase, string> = {
  Scheduled: 'Scheduled maintenance',
  Started: 'Maintenance started',
  Ended: 'Maintenance finished',
  Cancelled: 'Maintenance cancelled',
};

/**
 * Window times are printed in UTC, not the instance timezone.
 *
 * Deliberate: this string is read by status page subscribers, who are not the
 * people who configured the instance and have no reason to know what
 * AppSettings.timezone is set to. An explicit "UTC" is unambiguous to
 * everyone; a bare local time is unambiguous to nobody.
 *
 * Mirrored by formatWindowTime in worker/internal/maintenance/notify.go —
 * same output, character for character.
 */
export function formatWindowTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export interface AnnouncementWindow {
  title: string;
  message: string | null;
  startsAt: Date;
  endsAt: Date;
  monitorNames: string[];
}

export interface Announcement {
  subject: string;
  message: string;
  phaseLabel: string;
  affected: string;
}

/** The subject and body of one announcement. Mirrored by BuildAnnouncement in Go. */
export function buildAnnouncement(phase: MaintenancePhase, window: AnnouncementWindow): Announcement {
  const affected = window.monitorNames.join(', ');
  const label = PHASE_LABELS[phase];

  const lines: string[] = [];
  switch (phase) {
    case 'Scheduled':
      lines.push(`Scheduled maintenance is planned for ${affected}.`);
      lines.push(`Window: ${formatWindowTime(window.startsAt)} — ${formatWindowTime(window.endsAt)}.`);
      break;
    case 'Started':
      lines.push(`Scheduled maintenance on ${affected} has started.`);
      lines.push(`Expected to finish by ${formatWindowTime(window.endsAt)}.`);
      break;
    case 'Ended':
      lines.push(`Scheduled maintenance on ${affected} has finished. Everything should be back to normal.`);
      break;
    case 'Cancelled':
      lines.push(`The scheduled maintenance on ${affected} has been cancelled.`);
      lines.push(`It was planned for ${formatWindowTime(window.startsAt)} — ${formatWindowTime(window.endsAt)}.`);
      break;
  }

  // The organiser's own note last, so it reads as detail under the facts
  // rather than competing with them.
  if (window.message) lines.push(window.message);

  return {
    subject: `[${label}] ${window.title}`,
    message: lines.join('\n'),
    phaseLabel: label,
    affected,
  };
}

/** The column that records an announcement as sent, per phase. Null = nothing to record. */
const PHASE_MARKS: Record<MaintenancePhase, 'notifiedScheduledAt' | 'notifiedStartedAt' | 'notifiedEndedAt' | null> = {
  Scheduled: 'notifiedScheduledAt',
  Started: 'notifiedStartedAt',
  Ended: 'notifiedEndedAt',
  // A cancelled window is deleted from everyone's calendar, not tracked: it
  // can only be cancelled once (the router refuses a second time), so there
  // is nothing for a send-once mark to protect against.
  Cancelled: null,
};

/**
 * Announces one phase of one maintenance window.
 *
 * Never throws: an announcement failing must not fail the mutation that
 * scheduled or cancelled the window — the window itself is the thing that
 * matters, and it is already committed by the time this runs.
 */
export async function announceMaintenance(windowId: string, phase: MaintenancePhase): Promise<void> {
  try {
    const window = await prisma.maintenanceWindow.findUnique({
      where: { id: windowId },
      include: { monitors: { include: { monitor: { select: { id: true, name: true } } } } },
    });
    if (!window) return;

    // Per-window opt-out: a five-minute config push nobody notices does not
    // need three e-mails.
    if (!window.notifySubscribers) return;

    const monitors = window.monitors.map((link) => link.monitor);
    const announcement = buildAnnouncement(phase, {
      title: window.title,
      message: window.message,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      monitorNames: monitors.map((m) => m.name),
    });

    await Promise.all([
      queueIntegrationDeliveries(announcement.subject, announcement.message),
      notifyStatusPageSubscribers(
        monitors.map((m) => m.id),
        phase,
        window.title,
        announcement,
      ),
    ]);

    const mark = PHASE_MARKS[phase];
    if (mark) {
      await prisma.maintenanceWindow.update({ where: { id: windowId }, data: { [mark]: new Date() } });
    }

    logger.info(`[Maintenance] Announced "${window.title}" (${phase})`);
  } catch (error) {
    logger.error(`[Maintenance] Failed to announce ${phase} for window ${windowId}`, error);
  }
}

/**
 * One Pending IntegrationDelivery per enabled Integration, delivered by the
 * Go integrations worker like any other.
 *
 * Deliberately *not* routed through the NotificationRule layer the way an
 * incident is: those rules match on monitor, tag and impact, and a
 * maintenance window has no impact — it is the opposite of one. A rule that
 * suppresses out-of-hours pages would silently eat the announcement that says
 * the work is happening out of hours.
 *
 * incidentId stays null, which is what tells the worker there is no incident
 * detail to join in for the Discord embed.
 */
async function queueIntegrationDeliveries(subject: string, message: string) {
  const integrations = await prisma.integration.findMany({ where: { enabled: true }, select: { id: true } });
  if (integrations.length === 0) return;

  await prisma.integrationDelivery.createMany({
    data: integrations.map((integration) => ({
      integrationId: integration.id,
      event: MAINTENANCE_EVENT,
      message: `${subject}: ${message}`,
    })),
  });
}

/**
 * Everyone subscribed to a published status page that carries any of the
 * affected monitors — the same audience, and the same de-duplication by
 * (channel, target), as an incident update reaches.
 */
async function notifyStatusPageSubscribers(
  monitorIds: string[],
  phase: MaintenancePhase,
  title: string,
  announcement: Announcement,
) {
  if (monitorIds.length === 0) return;

  const links = await prisma.statusPageComponent.findMany({
    where: { monitorId: { in: monitorIds }, statusPage: { isPublished: true } },
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
        jobs.push(() => sendDiscordAlert(subscriber.target, announcement.subject, announcement.message));
      } else {
        jobs.push(() =>
          sendEmail({
            to: subscriber.target,
            subject: announcement.subject,
            react: MaintenanceEmail({
              phase,
              phaseLabel: announcement.phaseLabel,
              title,
              message: announcement.message,
              affected: announcement.affected,
              linkUrl: `${dashboardBaseUrl()}/dashboard/maintenance`,
            }),
          }),
        );
      }
    }
  }

  if (jobs.length === 0) return;

  const results = await Promise.allSettled(jobs.map((job) => job()));
  const failed = results.filter((r) => r.status === 'rejected').length;
  logger.info(`[Maintenance] Notified ${jobs.length - failed}/${jobs.length} status page subscriber(s)`);
}
