import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logging';
import { recordHeartbeatPing } from '@/lib/heartbeat';
import { agentReportSchema, evaluateReport, serializeMetrics } from '@/lib/server-metrics';

/**
 * POST /api/agent/<token> — where a Server monitor's agent reports in.
 *
 * The sibling of /api/heartbeat/<token>, and unauthenticated for the same
 * reason: this URL lives in a systemd unit on a machine that has no dashboard
 * session and must not hold one. The token is the credential.
 *
 * The difference is the payload. A heartbeat says "I ran"; an agent says how
 * the machine is doing (worker/cmd/agent), and the thresholds on the monitor
 * decide whether that reading is worth an incident. Both then take the same
 * recording path, and both are marked Down by the same worker when they stop
 * arriving.
 */
export const dynamic = 'force-dynamic';

/** A report bigger than this is not a report from our agent. */
const MAX_BODY_BYTES = 16 * 1024;

type Params = { params: Promise<{ token: string }> };

async function handle(request: Request, token: string) {
  const monitor = await prisma.monitor.findUnique({
    where: { heartbeatToken: token },
    select: {
      id: true,
      name: true,
      type: true,
      enabled: true,
      interval: true,
      heartbeatGraceSeconds: true,
      autoIncidents: true,
      parentId: true,
      cpuThresholdPercent: true,
      memoryThresholdPercent: true,
      diskThresholdPercent: true,
    },
  });

  // Same answer for an unknown token and for a token belonging to a monitor
  // that is no longer a Server monitor: a caller holding one has no business
  // learning which of the two it is.
  if (!monitor || monitor.type !== 'Server') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // A paused monitor accepts the report and records nothing — the agent on the
  // other side keeps posting to a URL that answers 200, and resuming the
  // monitor needs no change on that machine. Same contract as a paused
  // heartbeat, and the same thing `enabled` means to every check worker.
  if (!monitor.enabled) {
    return NextResponse.json({ ok: true, paused: true });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Report too large' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Report is not valid JSON' }, { status: 400 });
  }

  const result = agentReportSchema.safeParse(parsed);
  if (!result.success) {
    return NextResponse.json({ error: 'Report does not look like an agent report' }, { status: 400 });
  }

  const receivedAt = new Date();
  const verdict = evaluateReport(result.data, {
    cpuThresholdPercent: monitor.cpuThresholdPercent,
    memoryThresholdPercent: monitor.memoryThresholdPercent,
    diskThresholdPercent: monitor.diskThresholdPercent,
  });

  await recordHeartbeatPing(monitor, {
    status: verdict.status,
    message: verdict.message,
    serverMetrics: serializeMetrics(result.data, receivedAt),
    failureSummary: verdict.breaches.length > 0 ? `is over its limits — ${verdict.breaches.join('; ')}` : null,
  });

  // The verdict goes back to the agent, so `agent -once` tells whoever is
  // setting it up whether the thresholds are doing anything, rather than a
  // bare "ok" that looks the same when they're misconfigured.
  return NextResponse.json({ ok: true, status: verdict.status, breaches: verdict.breaches });
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;

  try {
    return await handle(request, token);
  } catch (error) {
    // A failing endpoint looks to the agent exactly like a failing machine, so
    // say so in the logs rather than letting it read as a silent 500.
    logger.error('[Agent] Failed to record a report', error);
    return NextResponse.json({ error: 'Failed to record report' }, { status: 500 });
  }
}
