// Heartbeat (push) monitors — the dead man's switch half of monitoring.
//
// Every other monitor type is StayUp dialling out. A Heartbeat monitor is the
// reverse: a job calls /api/heartbeat/<token> when it finishes, and the
// absence of that call is the failure. That is the only way to watch
// something with no port open — a cron job, a nightly backup, an import
// script — which are precisely the things that stop quietly.
//
// This file owns everything that happens when a ping *arrives*: recording it,
// recovering the monitor on a success, and opening the incident on an
// explicit /fail. The one case it cannot see is silence — nothing calls this
// when nothing calls — so noticing an overdue heartbeat is
// worker/cmd/heartbeat's job. The two halves share one deadline definition,
// interval + grace, and one incident path (src/lib/incidents.ts /
// worker/internal/incidents), so a job that says it failed and a job that
// simply stopped page the same way.
import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logging';
import { ensureIncidentForMonitor, isIncidentSuppressed, noteMonitorRecovered } from '@/lib/incidents';
import { dashboardBaseUrl } from '@/lib/urls';
import {
  heartbeatDeadlineSeconds,
  type MonitorInterval,
  type MonitorStatus,
} from '@/lib/monitor-types';

/** How far back the uptime percentage is computed — same window as worker/internal/runner. */
const UPTIME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The token *is* the credential: it goes in a URL that gets pasted into a
 * crontab, so it can't be a guessable id. 24 random bytes, hex, which is the
 * same strength as the session tokens better-auth issues.
 */
export function generateHeartbeatToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

/** The URL a job pings. Shown in the monitor form, ready to copy into a cron line. */
export function heartbeatPingUrl(token: string): string {
  return `${dashboardBaseUrl()}/api/heartbeat/${token}`;
}

export interface HeartbeatPing {
  /**
   * 'Up' for a plain ping, 'Down' for an explicit /fail — a job that knows it
   * failed — and 'Degraded' for an agent report that breached a threshold.
   *
   * A Server monitor never reports itself Down: the machine just spoke to us,
   * so it is by definition reachable. Down for a Server monitor means silence,
   * which only worker/cmd/heartbeat can observe.
   */
  status: Extract<MonitorStatus, 'Up' | 'Degraded' | 'Down'>;
  /** Optional detail the sender posted (the tail of a log, a utilisation summary). */
  message?: string | null;
  /** Optional duration the job reported, in ms — rendered on the same graph as any other monitor's. */
  responseTime?: number | null;
  /**
   * The agent's latest reading, as JSON, for a Server monitor. Replaces
   * whatever was stored; absent leaves the column alone, so a heartbeat ping
   * never wipes a Server monitor's snapshot.
   */
  serverMetrics?: string | null;
  /**
   * What to say in the incident when this report isn't Up. The check's own
   * message describes the reading; this describes the problem, and the two are
   * not the same sentence for an agent ("Disk at 94%…" versus a log tail).
   */
  failureSummary?: string | null;
}

export interface HeartbeatMonitorRef {
  id: string;
  name: string;
  /** Heartbeat | Server — both push types share this whole path. */
  type: string;
  interval: string;
  heartbeatGraceSeconds: number | null;
  /** Off means this monitor is watched and charted but never pages. */
  autoIncidents: boolean;
  /** The monitor it sits behind, if any — whose being Down suppresses this one's incidents. */
  parentId: string | null;
}

/**
 * Records one arriving heartbeat.
 *
 * Deliberately shaped like one turn of worker/internal/runner's checkOne: the
 * raw MonitorCheck row is always written (invariant 8 — check history records
 * what actually happened), the uptime percentage is recomputed over the same
 * 30-day window, and the monitor's rolled-up status follows.
 *
 * Both directions of the lifecycle are handled here, because both are things
 * that happen when a ping *arrives*: a successful one recovers the monitor,
 * and an explicit /fail opens the incident straight away. Only the third case
 * — silence — belongs to worker/cmd/heartbeat, which is the half that can act
 * when nothing is happening.
 *
 * An explicit failure deliberately doesn't wait for that worker: the job has
 * just said it failed, and holding the page until its deadline passes would
 * mean sitting on known-bad news for a whole interval. The worker opening the
 * same incident later is harmless — ensureIncidentForMonitor is idempotent
 * per monitor.
 */
export async function recordHeartbeatPing(monitor: HeartbeatMonitorRef, ping: HeartbeatPing) {
  const checkedAt = new Date();
  const responseTime = ping.responseTime ?? 0;

  await prisma.monitorCheck.create({
    data: {
      monitorId: monitor.id,
      status: ping.status,
      responseTime,
      message: ping.message ?? null,
      checkedAt,
    },
  });

  const windowStart = new Date(checkedAt.getTime() - UPTIME_WINDOW_MS);
  const [total, up] = await Promise.all([
    prisma.monitorCheck.count({ where: { monitorId: monitor.id, checkedAt: { gte: windowStart } } }),
    prisma.monitorCheck.count({
      where: { monitorId: monitor.id, checkedAt: { gte: windowStart }, status: 'Up' },
    }),
  ]);
  const uptime = total > 0 ? Math.round((up / total) * 10_000) / 100 : 100;

  await prisma.monitor.update({
    where: { id: monitor.id },
    data: {
      status: ping.status,
      responseTime,
      uptime,
      lastCheckedAt: checkedAt,
      ...(ping.serverMetrics === undefined ? {} : { lastServerMetrics: ping.serverMetrics }),
    },
  });

  logger.info(
    `[Heartbeat] ${monitor.name} checked in (${ping.status}); next one due within ${heartbeatDeadlineSeconds(
      monitor.interval as MonitorInterval,
      monitor.heartbeatGraceSeconds,
    )}s`,
  );

  // A successful ping is a recovery, and recovery is not gated on
  // autoIncidents — same rule as syncIncidentForResult in the Go runner: an
  // incident that is already open (opened by the heartbeat worker, or by a
  // human) must still move to "Monitoring", or a job that starts working
  // again would leave its incident stranded as permanently investigating.
  if (ping.status === 'Up') {
    await noteMonitorRecovered({ id: monitor.id, name: monitor.name });
    return;
  }

  await openIncidentForFailure(monitor, ping.status, ping.failureSummary ?? ping.message ?? null);
}

/**
 * Opens the incident for a report that arrived saying something is wrong — an
 * explicit /fail from a job, or an agent reading past a threshold.
 *
 * Applies the same three gates the workers apply to any failing check: a
 * monitor with automatic incidents switched off, one under maintenance and one
 * whose parent is already Down all page nobody, and have to behave identically
 * here or the two paths would drift (invariant 12 in AGENTS.md).
 */
async function openIncidentForFailure(
  monitor: HeartbeatMonitorRef,
  status: 'Degraded' | 'Down',
  detail: string | null,
) {
  if (!monitor.autoIncidents) return;

  const { suppressed, reason } = await isIncidentSuppressed(monitor.id, monitor.parentId);
  if (suppressed) {
    logger.info(`[Heartbeat] ${monitor.name} reported a problem but ${reason} — skipping incident`);
    return;
  }

  // A Server monitor's agent describes what is wrong; a heartbeat job only
  // ever says that it failed.
  const fallback = monitor.type === 'Server' ? 'reported a problem' : 'reported a failed run';
  const message = `Automatically detected: ${monitor.name} ${detail ?? fallback}.`;

  const incident = await ensureIncidentForMonitor({ id: monitor.id, name: monitor.name }, status, message);
  logger.warn(`[Heartbeat] Incident open for ${monitor.name}: ${incident.title} (${incident.id})`);
}
