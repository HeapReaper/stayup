// Standalone worker that periodically checks every Ping monitor by sending a
// single ICMP echo request to its IP/host. The scheduling/persistence/
// incident-sync loop lives in src/lib/monitor-worker.ts (shared with the
// other monitor-type workers) — this file only knows how to perform one ping.
//
// Node has no built-in ICMP support — sending raw ICMP packets needs a raw
// socket, which in turn needs elevated (root/admin) privileges on every OS.
// Rather than require this worker to run privileged, we shell out to the OS's
// own `ping` binary (present on every platform) and time the whole call —
// its exit code tells us up/down, and wall-clock time is a good enough RTT
// without needing to parse ping's locale-dependent text output (Windows in
// Dutch prints "tijd=", not "time=", etc.).
//
// Run it with `npm run worker:ping` (see package.json). It's a separate
// long-running process from `next dev`/`next start` — it does not run inside
// the Next.js server.
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { runMonitorWorker, type MonitorCheckResult } from '@/lib/monitor-worker';

// Abort a ping attempt if it hasn't completed within this long.
const PING_TIMEOUT_MS = 10_000;

// ICMP echo replies are normally fast; a reply slower than this is marked
// "Degraded" instead of "Up" (lower than the HTTP/TCP workers' threshold —
// a slow ping is a stronger signal than a slow HTTP response).
const DEGRADED_THRESHOLD_MS = 500;

// Deliberately not importing the `Monitor` model type from `@prisma/client`
// here — this check only ever touches `url`, so a minimal local shape is
// enough (the full Monitor row passed in by the shared runner satisfies this
// structurally).
interface MonitorRef {
  url: string;
}

/** Sends a single ICMP echo request to `host`, resolving with the elapsed ms or rejecting on failure/timeout. */
function ping(host: string, timeoutMs: number): Promise<number> {
  const args =
    process.platform === 'win32'
      ? ['-n', '1', '-w', String(timeoutMs), host]
      : ['-c', '1', '-W', String(Math.ceil(timeoutMs / 1000)), host];

  return new Promise((resolve, reject) => {
    const startedAt = performance.now();

    execFile('ping', args, { timeout: timeoutMs + 1_000 }, (error) => {
      const responseTime = Math.round(performance.now() - startedAt);

      if (error) {
        reject(new Error(error.killed ? 'Ping timed out' : 'Host unreachable'));
        return;
      }

      resolve(responseTime);
    });
  });
}

async function performCheck(monitor: MonitorRef): Promise<MonitorCheckResult> {
  const host = monitor.url.trim();

  // A leading dash would be interpreted as a flag by the `ping` binary
  // rather than a hostname — refuse rather than pass it through.
  if (!host || host.startsWith('-')) {
    return {
      status: 'Down',
      statusCode: null,
      responseTime: 0,
      message: 'Invalid host',
    };
  }

  try {
    const responseTime = await ping(host, PING_TIMEOUT_MS);

    return {
      status: responseTime > DEGRADED_THRESHOLD_MS ? 'Degraded' : 'Up',
      statusCode: null,
      responseTime,
      message: null,
    };
  } catch (error) {
    return {
      status: 'Down',
      statusCode: null,
      responseTime: PING_TIMEOUT_MS,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

runMonitorWorker({
  workerLabel: 'ping-worker',
  monitorType: 'Ping',
  performCheck,
})
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[ping-worker] Fatal error', error);
    process.exit(1);
  });
