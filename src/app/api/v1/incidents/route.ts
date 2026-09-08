import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiErrorFrom, authenticateApiRequest } from '@/lib/api-v1';
import { incidentImpactEnum, incidentStatusEnum } from '@/lib/incidents';

/**
 * GET /api/v1/incidents — the incident log.
 *
 * Read-only, on purpose. Incidents are *produced* by monitors going down;
 * hand-writing one through an API would be creating an outage record for
 * something StayUp isn't watching, which is a status-page job rather than a
 * monitoring one. What a script actually wants here is the other direction:
 * "is anything on fire", to gate a deploy or feed a wallboard.
 *
 *   ?status=Investigating|Identified|Monitoring|Resolved
 *   ?impact=Critical|Major|Minor
 *   ?open=true          only incidents that haven't been resolved
 *   ?monitorId=<id>
 *   ?limit=1..200       default 50, newest first
 */
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function limitFrom(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const params = new URL(request.url).searchParams;
    const status = incidentStatusEnum.safeParse(params.get('status'));
    const impact = incidentImpactEnum.safeParse(params.get('impact'));
    const monitorId = params.get('monitorId');

    const incidents = await prisma.incident.findMany({
      where: {
        ...(status.success ? { status: status.data } : {}),
        ...(impact.success ? { impact: impact.data } : {}),
        ...(monitorId ? { monitorId } : {}),
        // "Open" is everything that isn't Resolved — the same definition the
        // workers use when deciding whether to open a second incident for a
        // monitor that is still failing.
        ...(params.get('open') === 'true' ? { status: { not: 'Resolved' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limitFrom(params.get('limit')),
      include: {
        monitor: { select: { id: true, name: true } },
        // The timeline, oldest first — the same order the dashboard renders
        // it in, so a script that prints it doesn't have to reverse it.
        updates: { orderBy: { createdAt: 'asc' }, select: { status: true, message: true, createdAt: true } },
      },
    });

    return NextResponse.json({
      data: incidents.map((incident) => ({
        id: incident.id,
        title: incident.title,
        status: incident.status,
        impact: incident.impact,
        monitorId: incident.monitorId,
        monitorName: incident.monitor?.name ?? null,
        acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: incident.resolvedAt?.toISOString() ?? null,
        createdAt: incident.createdAt.toISOString(),
        updates: incident.updates.map((update) => ({
          status: update.status,
          message: update.message,
          createdAt: update.createdAt.toISOString(),
        })),
      })),
    });
  } catch (error) {
    return apiErrorFrom(error);
  }
}
