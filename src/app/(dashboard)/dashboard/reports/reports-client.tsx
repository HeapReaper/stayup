'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, TrendingUp } from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { MonthlyReport, MonitorReportRow } from '@/trpc/routers/report';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ReportsClientPageProps {
  initialMonths: string[];
  initialMonth: string;
  initialReport: MonthlyReport;
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function ms(value: number | null): string {
  return value === null ? '—' : `${value} ms`;
}

function downtime(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** RFC 4180-ish: quote everything, double any embedded quote. */
function csvCell(value: string | number | null): string {
  if (value === null) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function toCsv(report: MonthlyReport): string {
  const header = [
    'Monitor', 'Type', 'Days with data', 'Total checks', 'Up', 'Degraded', 'Down',
    'Uptime %', 'SLO target %', 'Meets SLO', 'Error budget used %',
    'Avg ms', 'p50 ms', 'p95 ms', 'p99 ms', 'Max ms', 'Est. downtime minutes',
  ];

  const rows = report.rows.map((row) =>
    [
      row.monitorName, row.monitorType, row.daysWithData, row.totalChecks, row.upChecks,
      row.degradedChecks, row.downChecks, row.uptime, row.sloTarget,
      row.meetsSlo === null ? '' : row.meetsSlo ? 'yes' : 'no',
      row.errorBudgetUsed, row.avgResponseTime, row.p50ResponseTime, row.p95ResponseTime,
      row.p99ResponseTime, row.maxResponseTime, row.downtimeMinutes,
    ].map(csvCell).join(','),
  );

  return [header.map(csvCell).join(','), ...rows].join('\n');
}

function SloBadge({ row }: { row: MonitorReportRow }) {
  if (row.sloTarget === null) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex items-center gap-2">
      <Badge variant={row.meetsSlo ? 'secondary' : 'destructive'}>
        {row.meetsSlo ? 'Met' : 'Missed'} {row.sloTarget}%
      </Badge>
      {row.errorBudgetUsed !== null && (
        <span className="text-xs text-muted-foreground">{row.errorBudgetUsed}% of budget</span>
      )}
    </div>
  );
}

export default function ReportsClientPage({ initialMonths, initialMonth, initialReport }: ReportsClientPageProps) {
  const trpc = useTRPC();
  const [month, setMonth] = React.useState(initialMonth);

  const monthsQuery = useQuery({ ...trpc.report.availableMonths.queryOptions(), initialData: initialMonths });
  const months = monthsQuery.data.length > 0 ? monthsQuery.data : [initialMonth];

  const reportQuery = useQuery({
    ...trpc.report.monthly.queryOptions({ month }),
    ...(month === initialMonth ? { initialData: initialReport } : {}),
  });
  const report = reportQuery.data;

  const handleDownload = () => {
    if (!report) return;
    const blob = new Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stayup-report-${report.month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Availability and response-time distribution per calendar month, read from the daily
            rollups — so a month older than your raw-check retention still reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month} onValueChange={(val) => val && setMonth(val)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue>{(val: string) => formatMonth(val)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {months.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatMonth(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" className="gap-2" onClick={handleDownload} disabled={!report}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => window.print()} disabled={!report}>
            <Printer className="h-4 w-4" /> Print / PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> {formatMonth(month)}
          </CardTitle>
          <CardDescription>
            Uptime is Up checks over all checks, so a Degraded check counts against it. The
            percentiles are each day's percentile weighted by that day's check count — close to, but
            not identical to, a percentile over every individual check in the month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!report || report.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No rolled-up data for this month yet. The janitor worker summarizes each day once it is
              over, so today never appears here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Monitor</TableHead>
                    <TableHead className="text-right">Uptime</TableHead>
                    <TableHead>SLO</TableHead>
                    <TableHead className="text-right">p50</TableHead>
                    <TableHead className="text-right">p95</TableHead>
                    <TableHead className="text-right">p99</TableHead>
                    <TableHead className="text-right">Max</TableHead>
                    <TableHead className="text-right">Est. downtime</TableHead>
                    <TableHead className="text-right">Checks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((row) => (
                    <TableRow key={row.monitorId}>
                      <TableCell>
                        <div className="font-medium">{row.monitorName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.monitorType} · {row.daysWithData} day{row.daysWithData === 1 ? '' : 's'} of data
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{row.uptime}%</TableCell>
                      <TableCell><SloBadge row={row} /></TableCell>
                      <TableCell className="text-right tabular-nums">{ms(row.p50ResponseTime)}</TableCell>
                      <TableCell className="text-right tabular-nums">{ms(row.p95ResponseTime)}</TableCell>
                      <TableCell className="text-right tabular-nums">{ms(row.p99ResponseTime)}</TableCell>
                      <TableCell className="text-right tabular-nums">{ms(row.maxResponseTime)}</TableCell>
                      <TableCell className="text-right tabular-nums">{downtime(row.downtimeMinutes)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.totalChecks.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
