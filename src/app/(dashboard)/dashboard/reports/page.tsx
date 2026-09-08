import ReportsClientPage from '@/app/(dashboard)/dashboard/reports/reports-client';
import { caller } from '@/trpc/server';

export default async function ReportsPage() {
  const months = await caller.report.availableMonths();
  // Newest month with data, or the current one on an instance that has not
  // been rolled up yet (the janitor only summarizes days that are over).
  const month = months[0] ?? new Date().toISOString().slice(0, 7);
  const report = await caller.report.monthly({ month });

  return <ReportsClientPage initialMonths={months} initialMonth={month} initialReport={report} />;
}
