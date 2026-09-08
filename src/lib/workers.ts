// Worker liveness, read from the `worker_heartbeat` rows the Go binaries
// upsert on every tick (worker/internal/store's RecordHeartbeat).
//
// One of the few places with no TS/Go mirror pair: nothing in the Next.js app
// ever *writes* a heartbeat — it only reads them, here, for the dashboard and
// for /api/health. The workers are the only writers.
//
// Why this table exists at all: a monitor with no recent checks looks exactly
// the same whether its worker died or it was created a minute ago, so the
// dashboard used to have to guess. A heartbeat answers it directly, and says
// *which* worker — which is the thing you actually need when a container is
// crash-looping.
import { prisma } from '@/lib/prisma';
import { currentRevision, currentVersion, UNKNOWN_BUILD } from '@/lib/version';

/**
 * Every binary the Dockerfile builds and both compose files run. Listed here
 * so a worker that has never started is reported as missing rather than
 * silently absent from the list — the failure mode of a service someone
 * forgot to add to their stack.
 */
export const EXPECTED_WORKERS = [
  'https',
  'port',
  'ping',
  'dns',
  'probes',
  'heartbeat',
  'integrations',
  'janitor',
] as const;

export type WorkerName = (typeof EXPECTED_WORKERS)[number];

/** What each worker is for, so the dashboard can say more than its name. */
export const WORKER_LABELS: Record<string, string> = {
  https: 'HTTP(s) monitors',
  port: 'Port monitors',
  ping: 'Ping monitors',
  dns: 'DNS monitors',
  probes: 'Database, mail, gRPC, WebSocket & domain monitors',
  heartbeat: 'Heartbeat monitors (missed check-ins)',
  integrations: 'Notification delivery & escalation',
  janitor: 'Rollups, retention & update checks',
};

export type WorkerStatusView = {
  id: string;
  label: string;
  /** null when this worker has never written a heartbeat. */
  lastSeenAt: string | null;
  startedAt: string | null;
  intervalSeconds: number | null;
  version: string | null;
  revision: string | null;
  /** 'running' | 'stale' (heartbeats stopped) | 'missing' (never seen). */
  state: 'running' | 'stale' | 'missing';
  /** How long this process has been up, in seconds — a value that keeps resetting means it's crash-looping. */
  uptimeSeconds: number | null;
  /**
   * Resident set size at the last tick, in kibibytes — what `docker stats`
   * reports for that container. Null when the worker has never been seen, or
   * when it runs an image from before workers reported this.
   */
  memoryKb: number | null;
};

/**
 * A worker is late once it has missed three ticks, with a one-minute floor so
 * the 5-second check workers aren't called dead over a single slow tick.
 * Deliberately derived from the interval the worker itself recorded, so the
 * janitor's 15-minute cadence and a check worker's 5 seconds are both judged
 * on their own terms.
 */
function isStale(lastSeenAt: Date, intervalSeconds: number, now: number): boolean {
  const allowed = Math.max(intervalSeconds * 3, 60) * 1000;
  return now - lastSeenAt.getTime() > allowed;
}

export async function getWorkerStatuses(): Promise<WorkerStatusView[]> {
  const rows = await prisma.workerHeartbeat.findMany();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const now = Date.now();

  // Iterate the expected list, not the rows: an unknown row (a worker from a
  // newer image, say) still gets reported, but a missing one can't hide.
  const ids = [...new Set([...EXPECTED_WORKERS, ...rows.map((row) => row.id)])];

  return ids.map((id) => {
    const row = byId.get(id);
    const label = WORKER_LABELS[id] ?? 'Unknown worker';

    if (!row) {
      return {
        id,
        label,
        lastSeenAt: null,
        startedAt: null,
        intervalSeconds: null,
        version: null,
        revision: null,
        state: 'missing' as const,
        uptimeSeconds: null,
        memoryKb: null,
      };
    }

    return {
      id,
      label,
      lastSeenAt: row.lastSeenAt.toISOString(),
      startedAt: row.startedAt.toISOString(),
      intervalSeconds: row.intervalSeconds,
      version: row.version,
      revision: row.revision,
      state: isStale(row.lastSeenAt, row.intervalSeconds, now) ? ('stale' as const) : ('running' as const),
      uptimeSeconds: Math.max(Math.floor((row.lastSeenAt.getTime() - row.startedAt.getTime()) / 1000), 0),
      memoryKb: row.memoryKb,
    };
  });
}

/**
 * The Next.js process's own footprint.
 *
 * Deliberately *not* part of getWorkerStatuses(): that function's result is
 * counted by /api/health, and folding a process that is running by definition
 * (it is the one answering) into those counts would inflate them. It also has
 * no heartbeat row and needs none — the process being measured is the process
 * answering the query, so the number is read live rather than out of the
 * database.
 *
 * Caveat worth knowing when reading the dashboard: behind more than one app
 * replica this is whichever replica served the request, not a total.
 */
export type AppProcessView = {
  label: string;
  /** Resident set size right now, in kibibytes — the same measure the workers report. */
  memoryKb: number;
  /** Of that RSS, what V8's JS heap is using. The rest is the runtime, buffers and native memory. */
  heapUsedKb: number;
  uptimeSeconds: number;
  version: string | null;
  revision: string | null;
};

export function getAppProcessStatus(): AppProcessView {
  const memory = process.memoryUsage();
  const version = currentVersion();
  const revision = currentRevision();

  return {
    label: 'Dashboard, API & status pages',
    memoryKb: Math.round(memory.rss / 1024),
    heapUsedKb: Math.round(memory.heapUsed / 1024),
    uptimeSeconds: Math.floor(process.uptime()),
    version: version === UNKNOWN_BUILD ? null : version,
    revision: revision === UNKNOWN_BUILD ? null : revision,
  };
}
