import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getWorkerStatuses } from '@/lib/workers';

/**
 * Container healthcheck, used by the `web` service in every compose file.
 *
 * Replaces hitting /login, which only proved that Next.js was serving HTML —
 * it stayed green with an unreachable database, and green *before*
 * `prisma migrate deploy` had finished. That mattered because every worker
 * waits for `web` to be healthy precisely so it never starts against an
 * unmigrated schema.
 *
 * Only the database decides the status code. Worker liveness is reported but
 * never fails the check: a dead `ping` worker must not make Docker restart
 * the web container, which would take the dashboard down for a problem it
 * can't fix. Watch the counts here (or the dashboard) for that instead.
 *
 * Unauthenticated by necessity — a healthcheck has no session — so the body
 * is counts only: no worker names, versions, or anything else worth knowing
 * for someone who shouldn't be looking.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();

  try {
    // A real query through the generated client, not a raw ping: it proves
    // the connection *and* that the schema this build expects is actually
    // there, which is the failure this endpoint exists to catch.
    await prisma.user.count();
  } catch {
    return NextResponse.json(
      { status: 'error', database: { ok: false }, message: 'Database unreachable or not migrated' },
      { status: 503 },
    );
  }

  const latencyMs = Date.now() - startedAt;

  let workers = { total: 0, running: 0, stale: 0, missing: 0 };
  try {
    const statuses = await getWorkerStatuses();
    workers = {
      total: statuses.length,
      running: statuses.filter((worker) => worker.state === 'running').length,
      stale: statuses.filter((worker) => worker.state === 'stale').length,
      missing: statuses.filter((worker) => worker.state === 'missing').length,
    };
  } catch {
    // Reported as zeroes rather than failing the check — see the note above.
  }

  return NextResponse.json({
    status: 'ok',
    database: { ok: true, latencyMs },
    workers,
    time: new Date().toISOString(),
  });
}
