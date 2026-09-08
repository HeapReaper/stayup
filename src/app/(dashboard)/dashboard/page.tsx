import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Gauge,
  MonitorCheck,
  PauseCircle,
  Plus,
  ShieldAlert,
  Siren,
  Wrench,
} from 'lucide-react';

import { caller } from '@/trpc/server';
import AutoRefresh from '@/components/core/autoRefresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * The operations overview: what is broken right now, what is about to break,
 * and what someone is already working on. Everything here is derived from the
 * rows the other pages show — this page stores nothing of its own, it just
 * puts the urgent parts of four tables on one screen.
 *
 * A server component refreshed on a timer, like the public status page:
 * nothing on it is interactive, and re-deriving on the server keeps the
 * staleness and certificate rules in one place.
 */

/** Each monitor's check interval, for the "no recent check" test below. */
const INTERVAL_MS: Record<string, number> = {
  '15s': 15_000,
  '30s': 30_000,
  '60s': 60_000,
  '5m': 300_000,
};

/**
 * A monitor whose worker died stays frozen at its last status — green, if it
 * was green — which is the one failure mode neither the monitors list nor a
 * status page will show you. Three missed intervals (but never less than two
 * minutes, so a 15s monitor doesn't complain about one slow tick) is the line
 * between "late" and "nobody is checking this any more".
 */
function isStale(monitor: { interval: string; lastCheckedAt: string | null }, now: number): boolean {
  if (!monitor.lastCheckedAt) return true;
  const interval = INTERVAL_MS[monitor.interval] ?? INTERVAL_MS['60s'];
  return now - new Date(monitor.lastCheckedAt).getTime() > Math.max(interval * 3, 120_000);
}

/** "4m ago". Hand-rolled because the app formats its own dates everywhere else. */
function relativeTime(iso: string | null): string {
  if (!iso) return 'never';

  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

type AttentionItem = {
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
};

function StatTile({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneClass = {
    neutral: 'text-foreground',
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-rose-600 dark:text-rose-400',
  }[tone];

  return (
    <Card className="shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <Icon className={`h-4 w-4 shrink-0 ${toneClass}`} />
        </div>
        <p className={`mt-2 text-3xl font-bold tabular-nums ${toneClass}`}>{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');

  const [monitors, incidents, windows, settings] = await Promise.all([
    caller.monitor.getAll(),
    caller.incident.getAll(),
    caller.maintenance.getAll(),
    caller.settings.get(),
  ]);

  const now = Date.now();

  // Paused monitors are counted apart from the rest everywhere below: no
  // worker checks them, so folding them into "up" would overstate how much is
  // actually being watched.
  const active = monitors.filter((monitor) => monitor.enabled);
  const pausedCount = monitors.length - active.length;
  const down = active.filter((monitor) => monitor.status === 'Down');
  const degraded = active.filter((monitor) => monitor.status === 'Degraded');
  const upCount = active.length - down.length - degraded.length;

  const openIncidents = incidents.filter((incident) => incident.status !== 'Resolved');
  const unacknowledged = openIncidents.filter((incident) => !incident.acknowledgedAt);

  const measured = active.filter((monitor) => typeof monitor.responseTime === 'number');
  const avgResponse = measured.length
    ? Math.round(measured.reduce((sum, m) => sum + (m.responseTime ?? 0), 0) / measured.length)
    : null;
  const avgUptime = active.length
    ? active.reduce((sum, m) => sum + m.uptime, 0) / active.length
    : null;

  const stale = active.filter((monitor) => isStale(monitor, now));

  const activeWindows = windows.filter((window) => window.status === 'Active');
  const upcomingWindows = windows.filter((window) => window.status === 'Scheduled');

  // One prioritised list rather than a card per problem class: at 3am the
  // question is "what do I look at first", not "which category is this".
  const attention: AttentionItem[] = [
    ...down.map((monitor): AttentionItem => ({
      severity: 'critical',
      title: monitor.name,
      detail: `Down · checked ${relativeTime(monitor.lastCheckedAt)}`,
    })),
    ...degraded.map((monitor): AttentionItem => ({
      severity: 'warning',
      title: monitor.name,
      detail: `Degraded${monitor.responseTime ? ` · ${monitor.responseTime} ms` : ''} · checked ${relativeTime(monitor.lastCheckedAt)}`,
    })),
    ...stale.map((monitor): AttentionItem => ({
      severity: 'warning',
      title: monitor.name,
      detail: monitor.lastCheckedAt
        ? `Last check ${relativeTime(monitor.lastCheckedAt)} — the ${monitor.type} worker may not be running`
        : `Never checked — the ${monitor.type} worker may not be running`,
    })),
    ...active
      .filter(
        (monitor) =>
          monitor.certExpiresAt &&
          daysUntil(monitor.certExpiresAt) <= settings.certExpiryWarningDays,
      )
      .map((monitor): AttentionItem => {
        const days = daysUntil(monitor.certExpiresAt as string);
        return {
          severity: days <= 0 ? 'critical' : 'warning',
          title: monitor.name,
          detail:
            days <= 0
              ? 'TLS certificate has expired'
              : `TLS certificate expires in ${days} day${days === 1 ? '' : 's'}`,
        };
      }),
  ];

  const criticalCount = attention.filter((item) => item.severity === 'critical').length;

  const health =
    down.length > 0
      ? {
          tone: 'bad' as const,
          icon: Siren,
          title: `${down.length} monitor${down.length === 1 ? ' is' : 's are'} down`,
          detail:
            'Incidents open automatically unless a maintenance window covers the monitor.',
        }
      : degraded.length > 0
        ? {
            tone: 'warn' as const,
            icon: AlertTriangle,
            title: `${degraded.length} monitor${degraded.length === 1 ? ' is' : 's are'} degraded`,
            detail:
              'Answering, but slower than the latency threshold or close to a certificate expiry.',
          }
        : stale.length > 0
          ? {
              // Deliberately not "operational": the status shown for these is
              // whatever they were when the checks stopped arriving, which
              // says nothing about now.
              tone: 'warn' as const,
              icon: AlertTriangle,
              title: `${stale.length} monitor${stale.length === 1 ? ' has' : 's have'} stopped reporting`,
              detail:
                'No recent checks arrived. The worker for that monitor type may not be running — see Needs attention below.',
            }
          : {
              tone: 'good' as const,
              icon: CheckCircle2,
              title: 'All systems operational',
              detail: `${active.length} monitor${active.length === 1 ? '' : 's'} checking on schedule.`,
            };

  const healthClass = {
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    bad: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  }[health.tone];

  // Nothing to monitor yet: every panel below would be an empty box, so the
  // page becomes one instruction instead.
  if (monitors.length === 0) {
    return (
      <div className="flex-1">
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
            <MonitorCheck className="h-10 w-10 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-bold">Nothing is being monitored yet</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a monitor and a worker starts checking it within seconds. Incidents, alerts and
                status pages all follow from there.
              </p>
            </div>
            <Button className="gap-2">
              <Link href="/dashboard/monitors" className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> Add your first monitor
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6">
      <AutoRefresh />

      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            {settings.organizationName} · signed in as {session.user.name}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Refreshes every minute</p>
      </div>

      {/* The one sentence worth reading first. */}
      <div className={`flex items-start gap-3 rounded-lg border p-4 ${healthClass}`}>
        <health.icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">{health.title}</p>
          <p className="text-xs text-muted-foreground">{health.detail}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Monitors up"
          value={`${upCount}/${active.length}`}
          detail={[
            `${down.length} down`,
            `${degraded.length} degraded`,
            pausedCount ? `${pausedCount} paused` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          icon={MonitorCheck}
          tone={down.length ? 'bad' : degraded.length ? 'warn' : 'good'}
        />
        <StatTile
          label="Open incidents"
          value={String(openIncidents.length)}
          detail={
            openIncidents.length === 0 ? 'Nothing open' : `${unacknowledged.length} unacknowledged`
          }
          icon={Siren}
          tone={unacknowledged.length ? 'bad' : openIncidents.length ? 'warn' : 'good'}
        />
        <StatTile
          label="Avg response"
          value={avgResponse === null ? '—' : `${avgResponse} ms`}
          detail={
            avgResponse === null
              ? 'No checks recorded yet'
              : `Across ${measured.length} monitor${measured.length === 1 ? '' : 's'} · threshold ${settings.latencyThresholdMs} ms`
          }
          icon={Gauge}
          tone={
            avgResponse !== null && avgResponse > settings.latencyThresholdMs ? 'warn' : 'neutral'
          }
        />
        <StatTile
          label="Uptime (30d)"
          value={avgUptime === null ? '—' : `${avgUptime.toFixed(2)}%`}
          detail="Average across active monitors"
          icon={Activity}
          tone={avgUptime !== null && avgUptime < 99 ? 'warn' : 'good'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Open incidents */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Siren className="h-5 w-5 text-muted-foreground" /> Open incidents
              </CardTitle>
              <CardDescription>Unresolved, newest first.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0">
              <Link href="/dashboard/incidents" className="flex items-center gap-1">
                All incidents <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {openIncidents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No open incidents.</p>
            ) : (
              <ul className="divide-y">
                {openIncidents.slice(0, 5).map((incident) => (
                  <li key={incident.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{incident.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {incident.monitor?.name ?? 'No monitor'} · opened{' '}
                        {relativeTime(incident.createdAt)}
                        {incident.acknowledgedAt
                          ? ` · acknowledged by ${incident.acknowledgedBy?.name ?? 'someone'}`
                          : ' · not acknowledged'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={
                          incident.impact === 'Critical'
                            ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : incident.impact === 'Major'
                              ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'text-muted-foreground'
                        }
                      >
                        {incident.impact}
                      </Badge>
                      <Badge variant="outline" className="text-muted-foreground">
                        {incident.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {openIncidents.length > 5 && (
              <p className="pt-3 text-xs text-muted-foreground">
                +{openIncidents.length - 5} more open.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Maintenance */}
        <Card className="shadow-sm">
          <CardHeader className="space-y-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wrench className="h-5 w-5 text-muted-foreground" /> Maintenance
            </CardTitle>
            <CardDescription>Alerts are suppressed while a window is active.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeWindows.length === 0 && upcomingWindows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              <>
                {activeWindows.map((window) => (
                  <div
                    key={window.id}
                    className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3"
                  >
                    <p className="truncate text-sm font-medium">{window.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Active · ends {new Date(window.endsAt).toLocaleString()}
                    </p>
                  </div>
                ))}
                {upcomingWindows.slice(0, 3).map((window) => (
                  <div key={window.id} className="rounded-md border p-3">
                    <p className="truncate text-sm font-medium">{window.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Starts {new Date(window.startsAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* Needs attention */}
        <Card className="shadow-sm lg:col-span-3">
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldAlert className="h-5 w-5 text-muted-foreground" /> Needs attention
              </CardTitle>
              <CardDescription>
                Down and degraded monitors, checks that stopped arriving, and certificates inside
                the {settings.certExpiryWarningDays}-day warning window.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0">
              <Link href="/dashboard/monitors" className="flex items-center gap-1">
                All monitors <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Every active monitor is up, checking on schedule and holding a valid certificate.
              </div>
            ) : (
              <ul className="divide-y">
                {attention.slice(0, 8).map((item, index) => (
                  <li
                    key={`${item.title}-${index}`}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {item.severity === 'critical' ? (
                        <Siren className="h-4 w-4 shrink-0 text-rose-500" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                      )}
                      <span className="truncate text-sm font-medium">{item.title}</span>
                    </div>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {attention.length > 8 && (
              <p className="pt-3 text-xs text-muted-foreground">
                +{attention.length - 8} more, {criticalCount} critical in total.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> Every monitor is checked on its own interval
        </span>
        {pausedCount > 0 && (
          <span className="flex items-center gap-1">
            <PauseCircle className="h-3.5 w-3.5" /> {pausedCount} paused monitor
            {pausedCount === 1 ? '' : 's'} not being checked
          </span>
        )}
      </div>
    </div>
  );
}
