// Standalone worker that periodically checks every DNS monitor by resolving
// its hostname's A record(s). The scheduling/persistence/incident-sync loop
// lives in src/lib/monitor-worker.ts (shared with the other monitor-type
// workers) — this file only knows how to perform one DNS lookup.
//
// Run it with `npm run worker:dns` (see package.json). It's a separate
// long-running process from `next dev`/`next start` — it does not run inside
// the Next.js server.
import 'dotenv/config';
import dns from 'node:dns/promises';
import { runMonitorWorker, type MonitorCheckResult } from '@/lib/monitor-worker';
import { getSettings } from '@/lib/settings';

// Deliberately not importing the `Monitor` model type from `@prisma/client`
// here — this check only ever touches `url`, so a minimal local shape is
// enough (the full Monitor row passed in by the shared runner satisfies this
// structurally).
interface MonitorRef {
  url: string;
}

/** Races a promise against a timeout — dns.promises has no built-in AbortSignal support. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function performCheck(monitor: MonitorRef): Promise<MonitorCheckResult> {
  const host = monitor.url.trim();

  if (!host) {
    return {
      status: 'Down',
      statusCode: null,
      responseTime: 0,
      message: 'No hostname configured',
    };
  }

  // Read from the Settings page's Monitoring Defaults tab on every check —
  // cheap enough at this poll rate — so saving new values there takes effect
  // on the very next tick, no restart.
  const settings = await getSettings();
  const lookupTimeoutMs = settings.httpTimeoutSeconds * 1000;
  const degradedThresholdMs = settings.latencyThresholdMs;

  const startedAt = performance.now();

  try {
    // resolve() queries the configured DNS server directly (unlike lookup(),
    // which can be served straight from the OS/libc cache) — a truer "is the
    // record still there" check for an uptime monitor.
    const records = await withTimeout(dns.resolve(host), lookupTimeoutMs);
    const responseTime = Math.round(performance.now() - startedAt);

    if (records.length === 0) {
      return { status: 'Down', statusCode: null, responseTime, message: 'No DNS records returned' };
    }

    return {
      status: responseTime > degradedThresholdMs ? 'Degraded' : 'Up',
      statusCode: null,
      responseTime,
      message: null,
    };
  } catch (error) {
    const responseTime = Math.round(performance.now() - startedAt);

    return {
      status: 'Down',
      statusCode: null,
      responseTime,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

runMonitorWorker({
  workerLabel: 'dns-worker',
  monitorType: 'DNS',
  performCheck,
})
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[dns-worker] Fatal error', error);
    process.exit(1);
  });
