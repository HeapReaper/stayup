import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiErrorFrom, authenticateApiRequest } from '@/lib/api-v1';
import { getVisibleMaintenanceWindows } from '@/lib/maintenance';

/**
 * GET /api/v1/status — the whole instance in one object.
 *
 * The endpoint a wallboard polls, or a deploy script gates on. Everything
 * here is derived, nothing is stored: the counts come from the monitors, the
 * headline status comes from the counts.
 *
 * Distinct from the public status page (/status/<slug>), which shows one
 * curated set of components to the outside world. This shows everything the
 * instance watches, to somebody holding the API key.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const [monitors, openIncidents] = await Promise.all([
      prisma.monitor.findMany({
        select: { id: true, name: true, status: true, enabled: true, uptime: true, lastCheckedAt: true },
      }),
      prisma.incident.count({ where: { status: { not: 'Resolved' } } }),
    ]);

    // Paused monitors are counted separately and excluded from the headline:
    // nobody is checking them, so their stored status describes whenever they
    // were paused rather than now, and letting that decide "is the instance
    // healthy" would keep a long-forgotten pause showing as an outage.
    const active = monitors.filter((monitor) => monitor.enabled);
    const counts = {
      total: monitors.length,
      up: active.filter((m) => m.status === 'Up').length,
      degraded: active.filter((m) => m.status === 'Degraded').length,
      down: active.filter((m) => m.status === 'Down').length,
      paused: monitors.length - active.length,
    };

    const activeWindows = (
      await getVisibleMaintenanceWindows(monitors.map((monitor) => monitor.id))
    ).filter((window) => window.startsAt <= new Date());

    return NextResponse.json({
      data: {
        // Worst wins, which is what someone gating a deploy on this wants:
        // one monitor down makes the instance down, however green the rest is.
        status: counts.down > 0 ? 'Down' : counts.degraded > 0 ? 'Degraded' : 'Up',
        monitors: counts,
        openIncidents,
        activeMaintenance: activeWindows.map((window) => ({
          id: window.id,
          title: window.title,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
          monitorIds: window.monitorIds,
        })),
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return apiErrorFrom(error);
  }
}
