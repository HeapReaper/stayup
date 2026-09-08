import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  API_MONITOR_RELATIONS,
  apiErrorFrom,
  authenticateApiRequest,
  readJsonBody,
  serializeApiMonitor,
} from '@/lib/api-v1';
import { createMonitor, monitorCreateInput } from '@/trpc/routers/monitor';
import { monitorStatusEnum, monitorTypeEnum } from '@/lib/monitor-types';

/**
 * GET  /api/v1/monitors — list every monitor
 * POST /api/v1/monitors — create one
 *
 * The write path is the *same function* the dashboard's tRPC mutation calls
 * (createMonitor in src/trpc/routers/monitor.ts), so a monitor provisioned by
 * Terraform is byte-for-byte the monitor the form would have produced — same
 * URL normalization, same per-type blanking, same audit entry. Two
 * implementations would drift the first time a column was added.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const params = new URL(request.url).searchParams;

    // Three filters, all optional, all narrow: enough for "which of my
    // monitors are down right now" without turning this into a query
    // language. An unrecognised value is ignored rather than rejected, so a
    // future monitor type can't break an old script's filter.
    const type = monitorTypeEnum.safeParse(params.get('type'));
    const status = monitorStatusEnum.safeParse(params.get('status'));
    const enabled = params.get('enabled');

    const monitors = await prisma.monitor.findMany({
      where: {
        ...(type.success ? { type: type.data } : {}),
        ...(status.success ? { status: status.data } : {}),
        ...(enabled === 'true' || enabled === 'false' ? { enabled: enabled === 'true' } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: API_MONITOR_RELATIONS,
    });

    return NextResponse.json({ data: monitors.map(serializeApiMonitor) });
  } catch (error) {
    return apiErrorFrom(error);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await readJsonBody(request);
    const input = monitorCreateInput.parse(body);
    const created = await createMonitor(input, auth.actor);

    // Re-read rather than returning what createMonitor produced: that is the
    // dashboard's shape, and every response here has to be the published one.
    const monitor = await prisma.monitor.findUniqueOrThrow({
      where: { id: created.id },
      include: API_MONITOR_RELATIONS,
    });

    return NextResponse.json({ data: serializeApiMonitor(monitor) }, { status: 201 });
  } catch (error) {
    return apiErrorFrom(error);
  }
}
