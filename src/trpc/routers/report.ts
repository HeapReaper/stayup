// SLA reporting: per-monitor availability and response-time distribution over
// a calendar month, plus the error budget against each monitor's SLO target.
//
// Everything here reads MonitorDailyStat, never raw checks — those are pruned
// on AppSettings.checkRetentionDays, while the rollups are kept forever
// (worker/cmd/janitor). That's what makes a report for a month older than the
// retention window still work, and it's why the percentile columns had to go
// into the rollup rather than being computed on demand.
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';

export type MonitorReportRow = {
  monitorId: string;
  monitorName: string;
  monitorType: string;
  /** Days in the month that actually have data — a monitor added mid-month has fewer. */
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

export type MonthlyReport = {
  month: string; // YYYY-MM
  from: string;
  to: string;
  rows: MonitorReportRow[];
};

const monthInput = z.object({
  // YYYY-MM. Calendar months, because that is the unit an SLA is written in.
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a YYYY-MM month'),
});

/** UTC bounds of a calendar month, matching how the rollups store `day`. */
function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const from = new Date(Date.UTC(year, monthNumber - 1, 1));
  const to = new Date(Date.UTC(year, monthNumber, 1));
  return { from, to };
}

/**
 * Weighted mean of a per-day percentile.
 *
 * A true monthly percentile needs the month's whole distribution, which the
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

export const reportRouter = createTRPCRouter({
  /** Which months have any rollups at all, newest first — drives the picker. */
  availableMonths: protectedProcedure.query(async () => {
    const range = await prisma.monitorDailyStat.aggregate({
      _min: { day: true },
      _max: { day: true },
    });
    if (!range._min.day || !range._max.day) return [] as string[];

    const months: string[] = [];
    const cursor = new Date(Date.UTC(range._min.day.getUTCFullYear(), range._min.day.getUTCMonth(), 1));
    const last = new Date(Date.UTC(range._max.day.getUTCFullYear(), range._max.day.getUTCMonth(), 1));

    while (cursor <= last) {
      months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return months.reverse();
  }),

  monthly: protectedProcedure.input(monthInput).query(async ({ input }): Promise<MonthlyReport> => {
    const { from, to } = monthBounds(input.month);

    const [monitors, stats] = await Promise.all([
      prisma.monitor.findMany({ select: { id: true, name: true, type: true, sloTarget: true } }),
      prisma.monitorDailyStat.findMany({
        where: { day: { gte: from, lt: to } },
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

    for (const monitor of monitors) {
      const days = byMonitor.get(monitor.id) ?? [];
      if (days.length === 0) continue;

      const totalChecks = days.reduce((sum, day) => sum + day.totalChecks, 0);
      const upChecks = days.reduce((sum, day) => sum + day.upChecks, 0);
      const degradedChecks = days.reduce((sum, day) => sum + day.degradedChecks, 0);
      const downChecks = days.reduce((sum, day) => sum + day.downChecks, 0);

      // Recomputed from the month's totals rather than averaging the daily
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
      // month's elapsed minutes is the honest estimate — exact enough for a
      // report, and it degrades gracefully when a monitor was paused.
      const elapsedMinutes = (Math.min(to.getTime(), Date.now()) - from.getTime()) / 60_000;
      const downtimeMinutes =
        totalChecks > 0
          ? Math.round(((degradedChecks + downChecks) / totalChecks) * elapsedMinutes * (days.length / daysIn(from, to)))
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

    return { month: input.month, from: from.toISOString(), to: to.toISOString(), rows };
  }),
});

/** Whole days in [from, to) — the length of the month being reported on. */
function daysIn(from: Date, to: Date): number {
  return Math.max(Math.round((to.getTime() - from.getTime()) / 86_400_000), 1);
}
