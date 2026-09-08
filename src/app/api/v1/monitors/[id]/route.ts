import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  API_MONITOR_RELATIONS,
  apiError,
  apiErrorFrom,
  authenticateApiRequest,
  readJsonBody,
  serializeApiMonitor,
} from '@/lib/api-v1';
import {
  deleteMonitor,
  monitorToInput,
  monitorUpdateInput,
  setMonitorEnabled,
  updateMonitor,
} from '@/trpc/routers/monitor';

/**
 * GET    /api/v1/monitors/{id} — read one
 * PATCH  /api/v1/monitors/{id} — change some of its fields
 * DELETE /api/v1/monitors/{id} — remove it, and its history with it
 *
 * PATCH is a genuine partial update, but it validates as a whole monitor: the
 * body is merged onto the stored one and the result goes through the same
 * schema the form does. That matters because the interesting rules are
 * cross-field — a Port monitor needs a port, a JsonPath assertion needs a
 * path, a HEAD request can't assert on a body — and none of them can be
 * judged from the changed fields alone.
 */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const monitor = await prisma.monitor.findUnique({ where: { id }, include: API_MONITOR_RELATIONS });
    if (!monitor) return apiError(404, 'Monitor not found');

    return NextResponse.json({ data: serializeApiMonitor(monitor) });
  } catch (error) {
    return apiErrorFrom(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const existing = await prisma.monitor.findUnique({ where: { id }, include: { tags: { include: { tag: true } } } });
    if (!existing) return apiError(404, 'Monitor not found');

    const body = await readJsonBody(request);

    // `enabled` is not part of the monitor input schema — pausing is its own
    // mutation on the dashboard too, because it deliberately touches nothing
    // else. Handled here so a script can pause a monitor without having to
    // resend its whole configuration.
    if (typeof body.enabled === 'boolean') {
      await setMonitorEnabled(id, body.enabled, auth.actor);
      delete body.enabled;
    }

    // Only re-run the full update when there is something left to change: a
    // body of just `{"enabled": false}` should not rewrite every column and
    // log a second audit entry.
    if (Object.keys(body).length > 0) {
      const merged = monitorUpdateInput.parse({ ...monitorToInput(existing), ...body, id });
      await updateMonitor(merged, auth.actor);
    }

    const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id }, include: API_MONITOR_RELATIONS });
    return NextResponse.json({ data: serializeApiMonitor(monitor) });
  } catch (error) {
    return apiErrorFrom(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    await deleteMonitor(id, auth.actor);

    return NextResponse.json({ data: { id } });
  } catch (error) {
    return apiErrorFrom(error);
  }
}
