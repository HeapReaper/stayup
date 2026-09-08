// Server monitors — the receiving half of worker/cmd/agent.
//
// A Server monitor is a Heartbeat monitor that carries a payload. The agent on
// the machine POSTs CPU, memory, disk and load; this validates that report,
// decides whether any threshold is exceeded, and hands the result to the same
// recording path a heartbeat ping uses (src/lib/heartbeat.ts). The absence of
// a report is still handled by worker/cmd/heartbeat, which sweeps both push
// types with one deadline rule.
//
// What this deliberately does not do is keep history per resource. "Was the
// disk 71% full last Tuesday" is a metrics store's question, and answering it
// would mean the one thing StayUp does not have — a columnar database. "Is it
// full right now, and does that page someone" is answered here, from a
// snapshot on the monitor row.
import { z } from 'zod';

/**
 * The agent's JSON body. Mirrors `Report` in
 * worker/internal/hostmetrics/hostmetrics.go.
 *
 * Every field is optional except the three that carry thresholds, and even
 * those are only used when the monitor sets one: an agent from a newer or
 * older build must not have its report rejected wholesale over a field that
 * moved. A rejected report reads as a missed report, and a missed report
 * pages someone.
 */
export const agentReportSchema = z.object({
  cpuPercent: z.number().min(0).max(100).optional(),
  memoryPercent: z.number().min(0).max(100).optional(),
  memoryTotalKb: z.number().int().min(0).optional(),
  memoryUsedKb: z.number().int().min(0).optional(),
  diskPercent: z.number().min(0).max(100).optional(),
  diskPath: z.string().max(500).optional(),
  diskTotalKb: z.number().int().min(0).optional(),
  diskUsedKb: z.number().int().min(0).optional(),
  load1: z.number().min(0).optional(),
  load5: z.number().min(0).optional(),
  load15: z.number().min(0).optional(),
  uptimeSeconds: z.number().int().min(0).optional(),
  hostname: z.string().max(255).optional(),
});

export type AgentReport = z.infer<typeof agentReportSchema>;

/** The thresholds a Server monitor holds its agent to. Null means "not held to one". */
export interface ServerThresholds {
  cpuThresholdPercent: number | null;
  memoryThresholdPercent: number | null;
  diskThresholdPercent: number | null;
}

export interface ServerVerdict {
  /**
   * Degraded when a threshold is exceeded, Up otherwise.
   *
   * Never Down, deliberately: the machine just spoke to us, so it is by
   * definition reachable. Down for a Server monitor means silence, and only
   * worker/cmd/heartbeat can observe that. A disk at 100% is a serious
   * problem and still not the same fact as a host that has vanished.
   */
  status: 'Up' | 'Degraded';
  /** Human summary, stored as the check's message and shown in the ping log. */
  message: string;
  /** Which thresholds were breached, for the incident text. */
  breaches: string[];
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Utilisation summary, in the order an operator scans it. */
function summarize(report: AgentReport): string {
  const parts: string[] = [];
  if (report.cpuPercent !== undefined) parts.push(`CPU ${formatPercent(report.cpuPercent)}`);
  if (report.memoryPercent !== undefined) parts.push(`memory ${formatPercent(report.memoryPercent)}`);
  if (report.diskPercent !== undefined) {
    parts.push(`disk ${formatPercent(report.diskPercent)}${report.diskPath ? ` (${report.diskPath})` : ''}`);
  }
  if (report.load1 !== undefined) parts.push(`load ${report.load1.toFixed(2)}`);

  return parts.length > 0 ? parts.join(', ') : 'agent reported no readings';
}

/**
 * Applies the monitor's thresholds to one report.
 *
 * A threshold is exceeded at *or above* the configured value, so "disk 90%"
 * fires at exactly 90 — the alternative surprises everyone who sets a round
 * number and watches it sit at 90.0 without alerting.
 */
export function evaluateReport(report: AgentReport, thresholds: ServerThresholds): ServerVerdict {
  const breaches: string[] = [];

  const check = (label: string, value: number | undefined, limit: number | null) => {
    if (value === undefined || limit === null) return;
    if (value >= limit) breaches.push(`${label} at ${formatPercent(value)} (threshold ${limit}%)`);
  };

  check('CPU', report.cpuPercent, thresholds.cpuThresholdPercent);
  check('Memory', report.memoryPercent, thresholds.memoryThresholdPercent);
  check('Disk', report.diskPercent, thresholds.diskThresholdPercent);

  const summary = summarize(report);
  if (breaches.length === 0) {
    return { status: 'Up', message: summary, breaches };
  }

  return { status: 'Degraded', message: `${breaches.join('; ')} — ${summary}`, breaches };
}

/**
 * What gets stored on `Monitor.lastServerMetrics`: the validated report plus
 * when it arrived, as JSON text.
 *
 * Text rather than columns because the shape belongs to the agent, and a new
 * reading (network counters, a second filesystem) should not need a migration
 * on both providers before anyone can see it. Nothing queries inside it —
 * thresholds are evaluated before it is written, and the dashboard only ever
 * reads the whole blob back.
 */
export function serializeMetrics(report: AgentReport, receivedAt: Date): string {
  return JSON.stringify({ ...report, receivedAt: receivedAt.toISOString() });
}

export type StoredServerMetrics = AgentReport & { receivedAt: string };

/** Reads the snapshot back for the dashboard; null when absent or unparseable. */
export function parseStoredMetrics(raw: string | null): StoredServerMetrics | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const result = agentReportSchema.safeParse(parsed);
    if (!result.success) return null;

    const receivedAt = typeof parsed.receivedAt === 'string' ? parsed.receivedAt : null;
    if (!receivedAt) return null;

    return { ...result.data, receivedAt };
  } catch {
    return null;
  }
}
