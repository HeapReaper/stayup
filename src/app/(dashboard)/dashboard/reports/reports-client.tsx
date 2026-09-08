'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, TrendingUp } from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { SlaReport, MonitorReportRow } from '@/trpc/routers/report';
import { monthDayBounds, monthOfRange, todayDay } from '@/lib/report-range';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type SelectableMonitor = {
  id: string;
  name: string;
  type: string;
  sloTarget: number | null;
};

interface ReportsClientPageProps {
  initialMonths: string[];
  initialFrom: string;
  initialTo: string;
  initialReport: SlaReport;
  initialMonitors: SelectableMonitor[];
}

/**
 * Sentinel for the quick-pick when the dates don't line up with a calendar
 * month. It is a real <SelectItem> rather than an empty value because Base
 * UI's Select shows the raw value when it can't resolve one to a label.
 */
const CUSTOM_RANGE = '__custom__';

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** UTC on purpose: the rollups are whole UTC days, so a local rendering would shift the label off by one. */
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
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

function toCsv(report: SlaReport): string {
  // From/To lead every row rather than sitting in a preamble: a preamble
  // breaks every spreadsheet import, and exporting several ranges is the
  // whole point of the date pickers — concatenated rows have to stay
  // attributable to the period they came from.
  const header = [
    'From', 'To',
    'Monitor', 'Type', 'Days with data', 'Total checks', 'Up', 'Degraded', 'Down',
    'Uptime %', 'SLO target %', 'Meets SLO', 'Error budget used %',
    'Avg ms', 'p50 ms', 'p95 ms', 'p99 ms', 'Max ms', 'Est. downtime minutes',
  ];

  const rows = report.rows.map((row) =>
    [
      report.from, report.to,
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

export default function ReportsClientPage({
  initialMonths,
  initialFrom,
  initialTo,
  initialReport,
  initialMonitors,
}: ReportsClientPageProps) {
  const trpc = useTRPC();
  const [from, setFrom] = React.useState(initialFrom);
  const [to, setTo] = React.useState(initialTo);
  // 'all' rather than an empty array: an empty *selection* and "no filter" are
  // opposite intentions, and collapsing them is how a report silently reports
  // on monitors nobody asked for.
  const [selection, setSelection] = React.useState<string[] | 'all'>('all');
  const [pdfPending, setPdfPending] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const monthsQuery = useQuery({ ...trpc.report.availableMonths.queryOptions(), initialData: initialMonths });
  const months = monthsQuery.data;

  const monitorsQuery = useQuery({
    ...trpc.report.selectableMonitors.queryOptions(),
    initialData: initialMonitors,
  });
  const monitors = monitorsQuery.data;
  const allIds = React.useMemo(() => monitors.map((monitor) => monitor.id), [monitors]);

  const checkedIds = selection === 'all' ? allIds : selection;
  const noneSelected = checkedIds.length === 0;
  const rangeInvalid = from > to;
  const canReport = !noneSelected && !rangeInvalid && !!from && !!to;

  const toggleMonitor = (id: string) => {
    const next = checkedIds.includes(id) ? checkedIds.filter((each) => each !== id) : [...checkedIds, id];
    // Everything ticked is the same request as no filter at all — keeping one
    // canonical form means the query key (and the CSV) don't change when a
    // monitor is added on another page.
    setSelection(next.length === allIds.length ? 'all' : next);
  };

  // 'all' is sent as [] — the server's "every monitor" — so a monitor created
  // after this page loaded still shows up on the next refetch.
  const monitorIds = selection === 'all' ? [] : selection;

  const reportQuery = useQuery({
    ...trpc.report.range.queryOptions({ from, to, monitorIds }),
    enabled: canReport,
    ...(from === initialFrom && to === initialTo && monitorIds.length === 0
      ? { initialData: initialReport }
      : {}),
  });
  const report = canReport ? reportQuery.data : undefined;

  const pickedMonth = monthOfRange(from, to);
  const today = todayDay();

  const handleMonthPick = (month: string | null) => {
    if (!month || month === CUSTOM_RANGE) return;
    const bounds = monthDayBounds(month);
    setFrom(bounds.from);
    setTo(bounds.to);
  };

  // Selected but absent from the table: the monitor exists and was asked for,
  // it just has no rolled-up day inside the range (added later, paused the
  // whole time, or the range is today — which is never rolled up yet). Saying
  // so beats a row quietly missing from an SLA report.
  const missing = report
    ? monitors.filter(
        (monitor) =>
          checkedIds.includes(monitor.id) && !report.rows.some((row) => row.monitorId === monitor.id),
      )
    : [];

  const save = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCsv = () => {
    if (!report) return;
    save(new Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' }), `stayup-sla-${report.from}_${report.to}.csv`);
  };

  // The PDF is rendered by the server (src/app/api/reports/pdf), from the
  // period and selection rather than from the rows on screen — so it carries
  // the organization name, looks the same for everyone who exports it, and
  // can't be talked into reporting numbers the database doesn't have.
  const handlePdf = async () => {
    if (!canReport) return;
    setPdfPending(true);
    setExportError(null);
    try {
      const response = await fetch('/api/reports/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, monitorIds }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `The report could not be generated (${response.status})`);
      }
      save(await response.blob(), `stayup-sla-${from}_${to}.pdf`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'The report could not be generated');
    } finally {
      setPdfPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Availability and response-time distribution over any range of days, read from the daily
            rollups — so a period older than your raw-check retention still reports.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={handleCsv} disabled={!report}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button className="gap-2" onClick={handlePdf} disabled={!canReport || pdfPending}>
              <FileText className="h-4 w-4" /> {pdfPending ? 'Generating PDF...' : 'Export PDF'}
            </Button>
          </div>
          {exportError && <p className="text-xs text-destructive">{exportError}</p>}
        </div>
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base">Report scope</CardTitle>
          <CardDescription>
            Pick the period and which monitors it covers, then export. Both exports contain exactly
            the rows below: the PDF is rendered on the server, the CSV carries the period on every row.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="report-month">Quick pick</Label>
              <Select value={pickedMonth ?? CUSTOM_RANGE} onValueChange={handleMonthPick}>
                <SelectTrigger id="report-month">
                  <SelectValue>
                    {(val: string) => (val === CUSTOM_RANGE ? 'Custom range' : formatMonth(val))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CUSTOM_RANGE}>Custom range</SelectItem>
                  {months.map((option) => (
                    <SelectItem key={option} value={option}>
                      {formatMonth(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="report-from">From</Label>
              <Input
                id="report-from"
                type="date"
                max={today}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="report-to">To</Label>
              <Input
                id="report-to"
                type="date"
                max={today}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Both days are included, in UTC — the unit the rollups are stored in. Today is never in a
            report: the janitor summarizes a day once it is over.
          </p>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Monitors</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {selection === 'all'
                    ? `All ${allIds.length} monitor${allIds.length === 1 ? '' : 's'}`
                    : `${checkedIds.length} of ${allIds.length} selected`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelection('all')}
                  disabled={selection === 'all'}
                >
                  Select all
                </Button>
              </div>
            </div>
            {monitors.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No monitors yet — create one on the Monitors page first.
              </p>
            ) : (
              <div className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                {monitors.map((monitor) => (
                  <label
                    key={monitor.id}
                    htmlFor={`report-monitor-${monitor.id}`}
                    className="flex cursor-pointer items-center gap-2.5 p-2.5"
                  >
                    <Checkbox
                      id={`report-monitor-${monitor.id}`}
                      checked={checkedIds.includes(monitor.id)}
                      onCheckedChange={() => toggleMonitor(monitor.id)}
                    />
                    <span className="truncate text-sm font-medium">{monitor.name}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {monitor.sloTarget !== null && (
                        <span className="text-xs text-muted-foreground">SLO {monitor.sloTarget}%</span>
                      )}
                      <Badge variant="outline" className="h-4 px-1 py-0 text-[10px]">
                        {monitor.type}
                      </Badge>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {rangeInvalid && (
            <p className="text-sm text-destructive">The end date cannot be before the start date.</p>
          )}
          {noneSelected && monitors.length > 0 && (
            <p className="text-sm text-destructive">Select at least one monitor to report on.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            {pickedMonth ? formatMonth(pickedMonth) : `${formatDay(from)} — ${formatDay(to)}`}
          </CardTitle>
          <CardDescription>
            {selection === 'all'
              ? 'Every monitor with rolled-up data in this period. '
              : `${checkedIds.length} of ${allIds.length} monitors. `}
            Uptime is Up checks over all checks, so a Degraded check counts against it. The
            percentiles are each day's percentile weighted by that day's check count — close to, but
            not identical to, a percentile over every individual check in the period.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!report || report.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {rangeInvalid || noneSelected
                ? 'Nothing to report on yet — adjust the scope above.'
                : 'No rolled-up data for this period yet. The janitor worker summarizes each day once it is over, so today never appears here.'}
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
              {missing.length > 0 && (
                <p className="pt-3 text-xs text-muted-foreground">
                  No rolled-up data in this period for: {missing.map((monitor) => monitor.name).join(', ')}.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
