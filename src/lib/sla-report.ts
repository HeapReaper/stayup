// The SLA report itself: the aggregation behind the Reports page, extracted
// from src/trpc/routers/report.ts so the tRPC query and the server-rendered
// PDF download (src/app/api/reports/pdf) build the *same* report from the
// *same* input validation. A PDF that disagrees with the table it was
// exported from is worse than no PDF at all.
//
// Everything here reads MonitorDailyStat, never raw checks — those are pruned
// on AppSettings.checkRetentionDays, while the rollups are kept forever
// (worker/cmd/janitor). That's what makes a report for a period older than the
// retention window still work, and it's why the percentile columns had to go
// into the rollup rather than being computed on demand.
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { DAY_PATTERN, dayRangeBounds, daysInRange } from '@/lib/report-range';

export type MonitorReportRow = {
  monitorId: string;
  monitorName: string;
  monitorType: string;
  /** Days in the range that actually have data — a monitor added halfway through has fewer. */
  daysWithData: number;
  totalChecks: number;
  upChecks: number;
  degradedChecks: number;
  downChecks: number;
  uptime: number;
  avgResponseTime: number | null;
  p50ResponseTime: number | null;
  p95ResponseTime: number | null;
  p99ResponseTime: number | null;
  maxResponseTime: number | null;
  sloTarget: number | null;
  /** Percentage points of the budget spent; null when there's no target. */
  errorBudgetUsed: number | null;
  meetsSlo: boolean | null;
  /** Roughly how long the monitor was not Up, from the check counts. */
  downtimeMinutes: number | null;
};

export type SlaReport = {
  /** The inclusive UTC days the report covers, as asked for (YYYY-MM-DD). */
  from: string;
  to: string;
  /**
   * Which monitors were asked for — empty means "every monitor". Echoed back so
   * the page can tell "this monitor was selected but has no data in the range"
   * apart from "this monitor wasn't selected", which look identical in `rows`.
   */
  monitorIds: string[];
  rows: MonitorReportRow[];
};

/** One monitor as the report's scope picker (and the PDF's header) needs it. */
export type SelectableMonitor = {
  id: string;
  name: string;
  type: string;
  sloTarget: number | null;
};

const dayInput = z.string().regex(DAY_PATTERN, 'Use a YYYY-MM-DD date');

/**
 * The one definition of "which report" — shared by the tRPC query and the PDF
 * route, so a range the page refuses can't be smuggled in through the
 * download URL.
 */
export const slaReportInput = z
  .object({
    from: dayInput,
    to: dayInput,
    // Empty = every monitor that has data in the range, which is what the page
    // opens with. A selection is a filter, never a promise that each of those
    // monitors produces a row: one with no rolled-up days in the range still
    // can't be reported on.
    monitorIds: z.array(z.string()).max(500).optional().default([]),
  })
  .refine((input) => input.from <= input.to, {
    message: 'The end date cannot be before the start date',
    path: ['to'],
  });

export type SlaReportInput = z.infer<typeof slaReportInput>;

/**
 * Weighted mean of a per-day percentile.
 *
 * A true percentile over the range needs its whole distribution, which the
 * rollups deliberately don't keep — so this is an approximation, weighted by
 * each day's check count so a quiet day doesn't count as much as a busy one.
 * Documented rather than hidden because "p95 for the month" from daily p95s
 * is not the same number as p95 over every request, and a report that pretends
 * otherwise is worse than one that says so.
 */
function weightedMean(values: { value: number | null; weight: number }[]): number | null {
  let total = 0;
  let weight = 0;
  for (const entry of values) {
    if (entry.value === null || entry.weight <= 0) continue;
    total += entry.value * entry.weight;
    weight += entry.weight;
  }
  return weight > 0 ? Math.round(total / weight) : null;
}

/** Every monitor that could go into a report, at the size a picker needs. */
export async function listSelectableMonitors(): Promise<SelectableMonitor[]> {
  return prisma.monitor.findMany({
    select: { id: true, name: true, type: true, sloTarget: true },
    orderBy: { name: 'asc' },
  });
}

export async function buildSlaReport(input: SlaReportInput): Promise<SlaReport> {
  const { start, endExclusive } = dayRangeBounds(input.from, input.to);
  // Prisma's `in: []` matches nothing, which is the opposite of what an empty
  // selection means here — hence the spread rather than a plain filter.
  const selected = input.monitorIds.length > 0 ? { id: { in: input.monitorIds } } : {};
  const selectedStats = input.monitorIds.length > 0 ? { monitorId: { in: input.monitorIds } } : {};

  const [monitors, stats] = await Promise.all([
    prisma.monitor.findMany({
      where: selected,
      select: { id: true, name: true, type: true, sloTarget: true },
    }),
    prisma.monitorDailyStat.findMany({
      where: { day: { gte: start, lt: endExclusive }, ...selectedStats },
      orderBy: { day: 'asc' },
    }),
  ]);

  const byMonitor = new Map<string, typeof stats>();
  for (const stat of stats) {
    const bucket = byMonitor.get(stat.monitorId);
    if (bucket) bucket.push(stat);
    else byMonitor.set(stat.monitorId, [stat]);
  }

  const rows: MonitorReportRow[] = [];
  const rangeDays = daysInRange(input.from, input.to);

  for (const monitor of monitors) {
    const days = byMonitor.get(monitor.id) ?? [];
    if (days.length === 0) continue;

    const totalChecks = days.reduce((sum, day) => sum + day.totalChecks, 0);
    const upChecks = days.reduce((sum, day) => sum + day.upChecks, 0);
    const degradedChecks = days.reduce((sum, day) => sum + day.degradedChecks, 0);
    const downChecks = days.reduce((sum, day) => sum + day.downChecks, 0);

    // Recomputed from the range's totals rather than averaging the daily
    // percentages, so a day with 12 checks doesn't weigh as much as a full one.
    const uptime = totalChecks > 0 ? Math.round((upChecks / totalChecks) * 10_000) / 100 : 100;

    const weights = days.map((day) => day.totalChecks);
    const pick = (field: 'avgResponseTime' | 'p50ResponseTime' | 'p95ResponseTime' | 'p99ResponseTime') =>
      weightedMean(days.map((day, index) => ({ value: day[field], weight: weights[index] })));

    const maxima = days.map((day) => day.maxResponseTime).filter((value): value is number => value !== null);

    const sloTarget = monitor.sloTarget;
    const errorBudgetUsed =
      sloTarget !== null && sloTarget < 100
        ? Math.round(((100 - uptime) / (100 - sloTarget)) * 10_000) / 100
        : null;

    // The rollups know how many checks failed, not for how long. Each check
    // stands for one interval, so the share of failed checks times the
    // range's elapsed minutes is the honest estimate — exact enough for a
    // report, and it degrades gracefully when a monitor was paused.
    const elapsedMinutes = (Math.min(endExclusive.getTime(), Date.now()) - start.getTime()) / 60_000;
    const downtimeMinutes =
      totalChecks > 0
        ? Math.round(((degradedChecks + downChecks) / totalChecks) * elapsedMinutes * (days.length / rangeDays))
        : null;

    rows.push({
      monitorId: monitor.id,
      monitorName: monitor.name,
      monitorType: monitor.type,
      daysWithData: days.length,
      totalChecks,
      upChecks,
      degradedChecks,
      downChecks,
      uptime,
      avgResponseTime: pick('avgResponseTime'),
      p50ResponseTime: pick('p50ResponseTime'),
      p95ResponseTime: pick('p95ResponseTime'),
      p99ResponseTime: pick('p99ResponseTime'),
      maxResponseTime: maxima.length > 0 ? Math.max(...maxima) : null,
      sloTarget,
      errorBudgetUsed,
      meetsSlo: sloTarget !== null ? uptime >= sloTarget : null,
      downtimeMinutes,
    });
  }

  rows.sort((a, b) => a.monitorName.localeCompare(b.monitorName));

  return { from: input.from, to: input.to, monitorIds: input.monitorIds, rows };
}
