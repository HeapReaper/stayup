import ReportsClientPage from '@/app/(dashboard)/dashboard/reports/reports-client';
import { caller } from '@/trpc/server';
import { monthDayBounds, todayDay } from '@/lib/report-range';

export default async function ReportsPage() {
  const months = await caller.report.availableMonths();
  // Newest month with data, or the current one on an instance that has not
  // been rolled up yet (the janitor only summarizes days that are over). The
  // page opens on a whole calendar month because that is what an SLA is
  // usually written against; the range is editable from there.
  const month = months[0] ?? todayDay().slice(0, 7);
  const { from, to } = monthDayBounds(month);

  const [report, monitors] = await Promise.all([
    // No monitorIds: every monitor with data in the range, which is the view
    // somebody landing on the page expects before narrowing it down.
    caller.report.range({ from, to, monitorIds: [] }),
    caller.report.selectableMonitors(),
  ]);

  return (
    <ReportsClientPage
      initialMonths={months}
      initialFrom={from}
      initialTo={to}
      initialReport={report}
      initialMonitors={monitors}
    />
  );
}
