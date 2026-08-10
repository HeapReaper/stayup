// Shared scheduling/persistence loop for monitor-check workers (src/workers/*.ts).
// Each worker only implements "how do I check one monitor" (performCheck) —
// this handles due-monitor polling, writing the MonitorCheck ("ping") row,
// rolling the result up onto the Monitor, incident sync, logging, and
// graceful shutdown, so every worker behaves consistently.
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logging';
import { monitorIntervalEnum, type MonitorInterval, type MonitorStatus, type MonitorType } from '@/trpc/routers/monitor';
import { ensureIncidentForMonitor, noteMonitorRecovered } from '@/lib/incidents';
import type { Monitor } from '@prisma/client';

export interface MonitorCheckResult {
  status: MonitorStatus;
  statusCode: number | null;
  responseTime: number;
  message: string | null;
}

export interface RunMonitorWorkerOptions {
  /** Log line prefix, e.g. "https-worker" or "port-worker". */
  workerLabel: string;
  /** Which Monitor.type this worker is responsible for. */
  monitorType: MonitorType;
  /**
   * Performs a single check. Should not throw for an expected failure (target
   * down, timed out, refused, ...) — catch that internally and return
   * status: 'Down' with a `message`, so a failed check still gets recorded as
   * a ping instead of silently dropping the tick.
   */
  performCheck: (monitor: Monitor) => Promise<MonitorCheckResult>;
  /** How often to poll for due monitors. Defaults to 5s. */
  tickIntervalMs?: number;
}

// How far back to look when recomputing the uptime percentage shown in the UI.
const UPTIME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const INTERVAL_MS: Record<MonitorInterval, number> = {
  '15s': 15_000,
  '30s': 30_000,
  '60s': 60_000,
  '5m': 5 * 60_000,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function intervalToMs(interval: string): number {
  const parsed = monitorIntervalEnum.safeParse(interval);
  return parsed.success ? INTERVAL_MS[parsed.data] : INTERVAL_MS['60s'];
}

function isDue(monitor: Monitor, now: number): boolean {
  if (!monitor.lastCheckedAt) return true;
  return now - monitor.lastCheckedAt.getTime() >= intervalToMs(monitor.interval);
}

async function recomputeUptime(monitorId: string): Promise<number> {
  const windowStart = new Date(Date.now() - UPTIME_WINDOW_MS);

  const [total, upCount] = await Promise.all([
    prisma.monitorCheck.count({
      where: { monitorId, checkedAt: { gte: windowStart } },
    }),
    prisma.monitorCheck.count({
      where: { monitorId, checkedAt: { gte: windowStart }, status: 'Up' },
    }),
  ]);

  if (total === 0) return 100;
  return Math.round((upCount / total) * 10_000) / 100;
}

// Opens/updates the monitor's incident to reflect the check result. Dedup and
// status rollup live in src/lib/incidents.ts, shared with the manual actions
// on the dashboard (src/trpc/routers/incident.ts) so every path behaves the
// same way.
async function syncIncidentForResult(
  workerLabel: string,
  monitor: Monitor,
  status: MonitorStatus,
  failureMessage: string | null,
): Promise<void> {
  try {
    if (status === 'Down' || status === 'Degraded') {
      const detail = failureMessage ? ` (${failureMessage})` : '';
      const incident = await ensureIncidentForMonitor(
        monitor,
        status,
        `Automatically detected: ${monitor.name} is ${status.toLowerCase()}${detail}.`,
      );
      logger.warn(`[${workerLabel}] Incident open for ${monitor.name}: ${incident.title} (${incident.id})`);
    } else {
      const incident = await noteMonitorRecovered(monitor);
      if (incident) {
        logger.info(`[${workerLabel}] Incident ${incident.id} moved to Monitoring after recovery`);
      }
    }
  } catch (error) {
    logger.error(`[${workerLabel}] Failed to sync incident for "${monitor.name}"`, error);
  }
}

async function checkOne(
  workerLabel: string,
  performCheck: RunMonitorWorkerOptions['performCheck'],
  monitor: Monitor,
): Promise<void> {
  const result = await performCheck(monitor);

  await prisma.monitorCheck.create({
    data: {
      monitorId: monitor.id,
      status: result.status,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      message: result.message,
    },
  });

  const uptime = await recomputeUptime(monitor.id);

  await prisma.monitor.update({
    where: { id: monitor.id },
    data: {
      status: result.status,
      responseTime: result.responseTime,
      uptime,
      lastCheckedAt: new Date(),
    },
  });

  const label = `${monitor.name} (${monitor.url}${monitor.port ? `:${monitor.port}` : ''})`;
  const details = `${result.status}${result.statusCode ? ` [${result.statusCode}]` : ''} in ${result.responseTime}ms`;

  if (result.status === 'Down') {
    logger.warn(`[${workerLabel}] ✗ ${label} -> ${details}${result.message ? ` — ${result.message}` : ''}`);
  } else if (result.status === 'Degraded') {
    logger.warn(`[${workerLabel}] ⚠ ${label} -> ${details}`);
  } else {
    logger.info(`[${workerLabel}] ✓ ${label} -> ${details}`);
  }

  await syncIncidentForResult(workerLabel, monitor, result.status, result.message);
}

async function tick(options: RunMonitorWorkerOptions): Promise<void> {
  const now = Date.now();

  const monitors = await prisma.monitor.findMany({
    where: { type: options.monitorType },
  });

  const due = monitors.filter((monitor) => isDue(monitor, now));

  if (due.length === 0) return;

  const results = await Promise.allSettled(
    due.map((monitor) => checkOne(options.workerLabel, options.performCheck, monitor)),
  );

  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.error(`[${options.workerLabel}] Failed to check monitor "${due[index].name}"`, result.reason);
    }
  }
}

/** Runs the poll/check/persist loop until SIGINT/SIGTERM. Resolves on clean shutdown. */
export async function runMonitorWorker(options: RunMonitorWorkerOptions): Promise<void> {
  const tickIntervalMs = options.tickIntervalMs ?? 5_000;

  logger.info(`[${options.workerLabel}] Started — polling every ${tickIntervalMs / 1000}s`);

  let running = true;
  const shutdown = (signal: string) => {
    logger.info(`[${options.workerLabel}] Received ${signal}, shutting down...`);
    running = false;
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  while (running) {
    try {
      await tick(options);
    } catch (error) {
      logger.error(`[${options.workerLabel}] Tick failed`, error);
    }

    await sleep(tickIntervalMs);
  }

  await prisma.$disconnect();
}
