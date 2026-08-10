// Standalone worker that periodically checks every Port monitor by attempting
// a raw TCP connection to host:port. The scheduling/persistence/incident-sync
// loop lives in src/lib/monitor-worker.ts (shared with the other monitor-type
// workers) — this file only knows how to perform one TCP check.
//
// Run it with `npm run worker:port` (see package.json). It's a separate
// long-running process from `next dev`/`next start` — it does not run inside
// the Next.js server.
import 'dotenv/config';
import net from 'node:net';
import { runMonitorWorker, type MonitorCheckResult } from '@/lib/monitor-worker';

// Abort a connection attempt if it hasn't succeeded within this long.
const CONNECT_TIMEOUT_MS = 10_000;

// A connection that succeeds but takes longer than this is marked "Degraded"
// instead of "Up".
const DEGRADED_THRESHOLD_MS = 1_000;

// Deliberately not importing the `Monitor` model type from `@prisma/client`
// here — this check only ever touches `url`/`port`, so a minimal local shape
// is enough (the full Monitor row passed in by the shared runner satisfies
// this structurally).
interface MonitorRef {
  url: string;
  port: number | null;
}

/** Attempts a TCP connect to host:port, resolving with the elapsed ms or rejecting with the failure reason. */
function tcpConnect(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      fn();
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(() => resolve(Math.round(performance.now() - startedAt))));
    socket.once('timeout', () => finish(() => reject(new Error('Connection timed out'))));
    socket.once('error', (error) => finish(() => reject(error)));

    socket.connect(port, host);
  });
}

async function performCheck(monitor: MonitorRef): Promise<MonitorCheckResult> {
  if (!monitor.port) {
    return {
      status: 'Down',
      statusCode: null,
      responseTime: 0,
      message: 'No port configured for this monitor',
    };
  }

  try {
    const responseTime = await tcpConnect(monitor.url, monitor.port, CONNECT_TIMEOUT_MS);

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
      responseTime: CONNECT_TIMEOUT_MS,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

runMonitorWorker({
  workerLabel: 'port-worker',
  monitorType: 'Port',
  performCheck,
})
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[port-worker] Fatal error', error);
    process.exit(1);
  });
