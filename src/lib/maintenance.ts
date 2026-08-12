// Shared maintenance-window helpers, used by the monitor-check workers (to
// suppress incident creation while a monitor is under maintenance) and by
// the statusPage router (to show a "Scheduled maintenance" notice on the
// public page instead of treating a Down/Degraded check as an outage).
import { prisma } from '@/lib/prisma';

/** A maintenance window counts as active once now >= startsAt, until now > endsAt, unless cancelled. */
function isActive(window: { startsAt: Date; endsAt: Date; cancelledAt: Date | null }, now: Date): boolean {
  if (window.cancelledAt) return false;
  return now >= window.startsAt && now <= window.endsAt;
}

/** True if `monitorId` is covered by a maintenance window that's active right now. */
export async function isMonitorUnderMaintenance(monitorId: string, now: Date = new Date()): Promise<boolean> {
  const links = await prisma.maintenanceWindowMonitor.findMany({
    where: {
      monitorId,
      maintenanceWindow: {
        cancelledAt: null,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
    },
    select: { id: true },
    take: 1,
  });

  return links.length > 0;
}

export interface MaintenanceWindowSummary {
  id: string;
  title: string;
  message: string | null;
  startsAt: Date;
  endsAt: Date;
  monitorIds: string[];
}

/**
 * Active or upcoming (not yet ended, not cancelled) maintenance windows that
 * cover any of `monitorIds` — used by the public status page to show a
 * notice above the affected monitors.
 */
export async function getVisibleMaintenanceWindows(
  monitorIds: string[],
  now: Date = new Date(),
): Promise<MaintenanceWindowSummary[]> {
  if (monitorIds.length === 0) return [];

  const windows = await prisma.maintenanceWindow.findMany({
    where: {
      cancelledAt: null,
      endsAt: { gte: now },
      monitors: { some: { monitorId: { in: monitorIds } } },
    },
    orderBy: { startsAt: 'asc' },
    include: { monitors: { select: { monitorId: true } } },
  });

  return windows.map((w) => ({
    id: w.id,
    title: w.title,
    message: w.message,
    startsAt: w.startsAt,
    endsAt: w.endsAt,
    monitorIds: w.monitors.map((m) => m.monitorId),
  }));
}
