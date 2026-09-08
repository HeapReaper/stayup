import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logging';
import { recordHeartbeatPing } from '@/lib/heartbeat';

/**
 * The heartbeat ping endpoint — where a Heartbeat monitor's job checks in.
 *
 *   GET|POST|HEAD /api/heartbeat/<token>        the job finished
 *   GET|POST|HEAD /api/heartbeat/<token>/fail   the job knows it failed
 *
 * Unauthenticated by necessity, and by design: this URL goes on the end of a
 * cron line (`… && curl -fsS $URL`) on a box that has no session and must not
 * hold a dashboard credential. The token is the credential — 24 random bytes,
 * regeneratable from the monitor form the moment one leaks.
 *
 * A catch-all segment rather than two routes so `/fail` can't drift away from
 * the plain ping: same lookup, same recording path, one flag apart.
 *
 * It answers 200 for anything it accepted and 404 for an unknown token, and
 * nothing else — a cron line reads the exit code of `curl -f` and no more, so
 * a body that says more than "ok" would only ever be read by a human pasting
 * the URL into a browser.
 */
export const dynamic = 'force-dynamic';

/**
 * Longest body kept as the check's message. A job piping its log tail into
 * the ping is the point (`curl --data-binary @- $URL < log`), but a
 * MonitorCheck.message is rendered in a table, so keep it to a paragraph.
 */
const MAX_MESSAGE_LENGTH = 1000;

async function readMessage(request: Request): Promise<string | null> {
  if (request.method === 'GET' || request.method === 'HEAD') return null;

  try {
    const body = (await request.text()).trim();
    if (!body) return null;
    return body.slice(0, MAX_MESSAGE_LENGTH);
  } catch {
    // A body we can't read is not a reason to lose the ping — the fact that
    // the job called at all is the signal.
    return null;
  }
}

/** `?rtt=1234` — how long the job itself took, in ms, if it cares to say. */
function readResponseTime(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get('rtt');
  if (!raw) return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(Math.round(parsed), 24 * 60 * 60 * 1000);
}

async function handle(request: Request, segments: string[]) {
  const [token, ...rest] = segments;

  // Exactly `<token>` or `<token>/fail`. Anything else is a typo in a cron
  // line, and answering 200 to it would make a monitor look healthy while
  // nothing is actually checking in.
  if (!token || rest.length > 1 || (rest.length === 1 && rest[0] !== 'fail')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const monitor = await prisma.monitor.findUnique({
    where: { heartbeatToken: token },
    select: {
      id: true,
      name: true,
      type: true,
      enabled: true,
      interval: true,
      heartbeatGraceSeconds: true,
      // Both only matter for an explicit /fail, which opens an incident right
      // here rather than waiting for the worker's deadline to pass.
      autoIncidents: true,
      parentId: true,
    },
  });

  // Same answer for "no such token" and "that token belongs to a monitor that
  // stopped being a Heartbeat": a caller holding a token has no business
  // learning which of the two it is.
  if (!monitor || monitor.type !== 'Heartbeat') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // A paused monitor accepts the ping and records nothing, deliberately: the
  // job on the other side keeps calling a URL that answers 200, and resuming
  // the monitor doesn't need the cron line touched. Pausing means "don't
  // watch this", which has to include not writing history for it — the same
  // thing `enabled` means to every check worker.
  if (!monitor.enabled) {
    return NextResponse.json({ ok: true, paused: true });
  }

  await recordHeartbeatPing(monitor, {
    status: rest[0] === 'fail' ? 'Down' : 'Up',
    message: await readMessage(request),
    responseTime: readResponseTime(request),
  });

  return NextResponse.json({ ok: true });
}

type Params = { params: Promise<{ segments: string[] }> };

async function run(request: Request, { params }: Params) {
  const { segments } = await params;

  try {
    return await handle(request, segments);
  } catch (error) {
    // A failing ping endpoint would look to the caller exactly like a failing
    // job, so say so in the logs rather than letting it read as a silent 500.
    logger.error('[Heartbeat] Failed to record a ping', error);
    return NextResponse.json({ error: 'Failed to record heartbeat' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
export const HEAD = run;
