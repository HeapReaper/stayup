// Date arithmetic shared by the SLA report router and the Reports page.
//
// A separate module for the same reason src/lib/monitor-types.ts is one: the
// Reports page's 'use client' component may not import
// src/trpc/routers/report.ts (that pulls in Prisma), but it needs exactly the
// same month → day conversion the query uses. Two copies of it is how a
// picker and the report it asks for start disagreeing about which days a
// month contains.
//
// Everything here is UTC, because MonitorDailyStat.day is: the janitor
// summarizes whole UTC days (worker/internal/store/janitor.go), so a report
// can't be more precise than that without going back to the raw checks — which
// are pruned on retention and therefore can't answer for older months at all.

/** One rolled-up day, YYYY-MM-DD. */
export const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A calendar month, YYYY-MM — the unit an SLA is usually written in. */
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The UTC day a Date falls on, as YYYY-MM-DD. */
export function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today, in UTC — the latest day a report can possibly cover. */
export function todayDay(): string {
  return toDay(new Date());
}

/**
 * First and last day of a calendar month, both inclusive. `to` is the real
 * last day (28th–31st), not the 1st of the next month: the pickers show these
 * two values to the user, and "1 Oct" in the To field of a September report
 * would be a lie about what it covers.
 */
export function monthDayBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const mm = String(monthNumber).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * The month a range covers exactly, or null for anything else — which is what
 * lets the month quick-pick show "September 2026" while an edited date range
 * shows "Custom range" instead of silently claiming to be a month it isn't.
 */
export function monthOfRange(from: string, to: string): string | null {
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) return null;
  const month = from.slice(0, 7);
  const bounds = monthDayBounds(month);
  return bounds.from === from && bounds.to === to ? month : null;
}

/**
 * The half-open [start, endExclusive) instant range to query rollups with.
 * Half-open because `day` is a timestamp at midnight UTC: `lt` the day after
 * `to` is the only way to include `to` itself, and a one-day report
 * (from === to) has to work.
 */
export function dayRangeBounds(from: string, to: string): { start: Date; endExclusive: Date } {
  const start = new Date(`${from}T00:00:00.000Z`);
  const endExclusive = new Date(`${to}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive };
}

/** Whole days in an inclusive range — at least 1, so a single-day report scales. */
export function daysInRange(from: string, to: string): number {
  const { start, endExclusive } = dayRangeBounds(from, to);
  return Math.max(Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000), 1);
}
