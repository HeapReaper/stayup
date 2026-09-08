// Monitor-type facts that both the server and the browser need.
//
// Deliberately its own module rather than living in src/trpc/routers/monitor.ts:
// that file imports Prisma, so a client component importing a *value* from it
// (rather than a type, which is erased) drags the database client into the
// browser bundle and the build fails.
import { z } from 'zod';

// Every type here must have a checker in worker/internal/checkers and be
// listed in that worker's ProbeTypes, or its monitors will simply never be
// checked — which looks exactly like a monitor that has never come up.
export const monitorTypeEnum = z.enum([
  'HTTP',
  'Ping',
  'Port',
  'DNS',
  'Postgres',
  'MySQL',
  'Redis',
  'SMTP',
  'IMAP',
  'gRPC',
  'WebSocket',
  'Domain',
  // The one type nothing dials. A Heartbeat monitor is checked by *not*
  // hearing from something: the job calls /api/heartbeat/<token> when it
  // finishes and worker/cmd/heartbeat flips the monitor Down when that call
  // doesn't arrive in time. Everything with no port open — cron jobs,
  // nightly backups, import scripts — is only monitorable this way.
  'Heartbeat',
  // The same inversion one layer down: an agent on the machine
  // (worker/cmd/agent) POSTs CPU, memory, disk and load to
  // /api/agent/<token>. A full disk is the classic outage no HTTP check ever
  // sees — the site answers 200 right up until the write that fails — because
  // every other monitor type is looking at the service from the outside.
  'Server',
]);
export type MonitorType = z.infer<typeof monitorTypeEnum>;

/**
 * The monitor types that report *in* rather than being dialled. They share
 * one push credential (`heartbeatToken`), one deadline rule (interval +
 * grace) and one worker that notices silence (worker/cmd/heartbeat); what
 * differs is the payload and what the endpoint does with it.
 */
export const PUSH_TYPES: MonitorType[] = ['Heartbeat', 'Server'];

/**
 * Monitor types StayUp dials out to — the distinction decides whether a
 * monitor needs a URL/host at all, so both the form and the router branch
 * on it.
 */
export function isActiveMonitorType(type: MonitorType): boolean {
  return !PUSH_TYPES.includes(type);
}

// The long end exists for Domain monitors: RDAP servers are rate-limited and
// a registry expiry date does not move minute to minute. Must stay in step
// with the `intervals` map in worker/internal/store/types.go.
export const monitorIntervalEnum = z.enum(['15s', '30s', '60s', '5m', '1h', '12h', '24h']);
export type MonitorInterval = z.infer<typeof monitorIntervalEnum>;

/**
 * The same table as `intervals` in worker/internal/store/types.go, in
 * seconds. Needed on this side because a Heartbeat monitor's deadline
 * (interval + grace) is shown in the form and computed by the ping endpoint,
 * not only by a worker.
 */
export const MONITOR_INTERVAL_SECONDS: Record<MonitorInterval, number> = {
  '15s': 15,
  '30s': 30,
  '60s': 60,
  '5m': 300,
  '1h': 3600,
  '12h': 43_200,
  '24h': 86_400,
};

/**
 * How late a heartbeat may be before the monitor is called Down, when the
 * monitor doesn't override it. A job scheduled hourly does not run at exactly
 * :00 every hour — it queues, it retries, the box is busy — so a deadline of
 * exactly `interval` would page on the first slow night.
 *
 * Must stay in step with defaultGraceSeconds in worker/cmd/heartbeat.
 */
export const DEFAULT_HEARTBEAT_GRACE_SECONDS = 60;

/**
 * How many regions a monitor may be required to agree with before a failure
 * is reported. Capped because the requirement is also capped at the number of
 * regions actually reporting (see agreedStatus in worker/internal/runner) —
 * anything past a handful is a number nobody can satisfy.
 */
export const MAX_CONFIRMATION_REGIONS = 10;

/** The deadline a heartbeat has to arrive within, in seconds. */
export function heartbeatDeadlineSeconds(
  interval: MonitorInterval,
  graceSeconds: number | null | undefined,
): number {
  return MONITOR_INTERVAL_SECONDS[interval] + (graceSeconds ?? DEFAULT_HEARTBEAT_GRACE_SECONDS);
}

export const monitorStatusEnum = z.enum(['Up', 'Down', 'Degraded']);
export type MonitorStatus = z.infer<typeof monitorStatusEnum>;

export const monitorMethodEnum = z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
export type MonitorMethod = z.infer<typeof monitorMethodEnum>;

/**
 * Monitor types whose check is "open a connection and speak enough of the
 * protocol to know something answered", handled by worker/cmd/probes. They
 * share the credential field and take a host in `url` (except Postgres, which
 * takes a full DSN) rather than anything URL-shaped.
 */
export const PROBE_TYPES: MonitorType[] = [
  'Postgres',
  'MySQL',
  'Redis',
  'SMTP',
  'IMAP',
  'gRPC',
  'WebSocket',
  'Domain',
];

/** Default port per type, applied by the workers when the form leaves it blank. */
export const DEFAULT_PORTS: Partial<Record<MonitorType, number>> = {
  Postgres: 5432,
  MySQL: 3306,
  Redis: 6379,
  SMTP: 25,
  IMAP: 143,
};

/**
 * Record types a DNS monitor can look up. 'A' is the default and what every
 * DNS monitor did before record selection existed, so existing rows keep
 * their behavior.
 *
 * The point of the others is the record whose absence breaks something but
 * that no HTTP check ever touches: an MX that stops resolving takes mail down
 * while the website stays green, and a TXT (SPF, DKIM, a domain-verification
 * token) that gets clobbered by a well-meaning DNS edit fails silently until
 * someone's mail starts bouncing.
 *
 * Must stay in step with lookupRecords() in worker/internal/checkers/dns.go.
 */
export const dnsRecordTypeEnum = z.enum(['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SRV']);
export type DnsRecordType = z.infer<typeof dnsRecordTypeEnum>;
