// Standalone worker that periodically checks every HTTP(s) monitor. The
// scheduling/persistence/incident-sync loop lives in src/lib/monitor-worker.ts
// (shared with the other monitor-type workers) — this file only knows how to
// perform one HTTP(s) check.
//
// Run it with `npm run worker:https` (see package.json). It's a separate
// long-running process from `next dev`/`next start` — it does not run inside
// the Next.js server.
import 'dotenv/config';
import { runMonitorWorker, type MonitorCheckResult } from '@/lib/monitor-worker';
import type { MonitorStatus } from '@/trpc/routers/monitor';
import type { Monitor } from '@prisma/client';

// Abort a check if the target hasn't responded within this long.
const REQUEST_TIMEOUT_MS = 10_000;

// A response that succeeds but is slower than this is marked "Degraded"
// instead of "Up".
const DEGRADED_THRESHOLD_MS = 1_000;

async function performCheck(monitor: Monitor): Promise<MonitorCheckResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let status: MonitorStatus = 'Down';
  let statusCode: number | null = null;
  let message: string | null = null;
  let responseTime: number;

  try {
    const response = await fetch(monitor.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'StayUp-Monitor/1.0' },
    });

    responseTime = Math.round(performance.now() - startedAt);
    statusCode = response.status;

    if (response.ok) {
      status = responseTime > DEGRADED_THRESHOLD_MS ? 'Degraded' : 'Up';
    } else {
      status = 'Down';
      message = `Unexpected status code ${response.status}`;
    }
  } catch (error) {
    responseTime = Math.round(performance.now() - startedAt);
    status = 'Down';
    message = error instanceof Error ? error.message : 'Unknown error';
  } finally {
    clearTimeout(timeout);
  }

  return { status, statusCode, responseTime, message };
}

runMonitorWorker({
  workerLabel: 'https-worker',
  monitorType: 'HTTP',
  performCheck,
})
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[https-worker] Fatal error', error);
    process.exit(1);
  });
