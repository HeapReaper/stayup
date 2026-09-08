// SLA reporting: per-monitor availability and response-time distribution over
// any range of days, plus the error budget against each monitor's SLO target.
//
// The aggregation itself lives in src/lib/sla-report.ts, because the
// server-rendered PDF download (src/app/api/reports/pdf) has to build exactly
// the same report from exactly the same validated input — this router is just
// the read API the page's table uses.
//
// The range is a pair of inclusive UTC days rather than a month because an SLA
// review rarely lines up with the calendar: a contract quarter, a two-week
// incident window, or "since the migration" are all things people ask a report
// for. Whole calendar months are still one click away — the page's quick-pick
// fills the same two fields from availableMonths (see src/lib/report-range.ts,
// which both sides share so the picker and the query agree on what a month is).
import { createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { buildSlaReport, listSelectableMonitors, slaReportInput } from '@/lib/sla-report';

// Re-exported so the page keeps importing its types from the router it calls.
export type { MonitorReportRow, SlaReport, SelectableMonitor } from '@/lib/sla-report';

export const reportRouter = createTRPCRouter({
  /** Which months have any rollups at all, newest first — drives the quick-pick. */
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

  /**
   * Every monitor that could go into a report, at the size the picker needs.
   * Deliberately not monitor.getAll: that returns request headers, credential
   * flags and tags for a checkbox list that shows a name and a type, and it is
   * the report's own scope list — it must include monitors with no rollups yet,
   * so somebody can see why one is missing from the table.
   */
  selectableMonitors: protectedProcedure.query(() => listSelectableMonitors()),

  range: protectedProcedure.input(slaReportInput).query(({ input }) => buildSlaReport(input)),
});
