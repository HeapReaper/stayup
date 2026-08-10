'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  RefreshCw,
  Mail,
  Send,
} from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { PublicStatusPage, PublicMonitorView, DayBucket, SubscriberChannel } from '@/trpc/routers/statuspage';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface StatusPageClientProps {
  slug: string;
  initialData: PublicStatusPage;
}

const REFRESH_INTERVAL_MS = 60_000;

function statusDotClass(status: string) {
  if (status === 'Down') return 'bg-rose-500';
  if (status === 'Degraded') return 'bg-amber-500';
  return 'bg-emerald-500';
}

function dayBucketClass(status: DayBucket['status']) {
  if (status === 'Down') return 'bg-rose-500 hover:bg-rose-600';
  if (status === 'Degraded') return 'bg-amber-500 hover:bg-amber-600';
  if (status === 'Up') return 'bg-emerald-500 hover:bg-emerald-600';
  return 'bg-muted hover:bg-muted-foreground/30';
}

function formatDayLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function OverallBanner({ status }: { status: PublicStatusPage['overallStatus'] }) {
  const config = {
    Operational: {
      icon: CheckCircle2,
      label: 'All Systems Operational',
      className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    },
    Degraded: {
      icon: AlertTriangle,
      label: 'Degraded Performance',
      className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    },
    Outage: {
      icon: XCircle,
      label: 'Major Outage',
      className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    },
  }[status];

  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-3 rounded-xl border p-4 ${config.className}`}>
      <Icon className="h-6 w-6 shrink-0" />
      <span className="text-lg font-semibold">{config.label}</span>
    </div>
  );
}

function UptimeHeatmap({ monitor }: { monitor: PublicMonitorView }) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Days run oldest -> newest, so "today" is the rightmost box. Start
  // scrolled all the way there instead of the default (leftmost/oldest).
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [monitor.days.length]);

  return (
    <div ref={scrollRef} className="overflow-x-auto pb-1">
      <div className="flex gap-[3px] w-max">
        {monitor.days.map((day) => (
          <Tooltip key={day.date}>
            <TooltipTrigger
              render={
                <span
                  className={`h-7 w-2 rounded-sm shrink-0 transition-colors ${dayBucketClass(day.status)}`}
                />
              }
            />
            <TooltipContent>
              <div className="space-y-0.5">
                <p className="font-medium">{formatDayLabel(day.date)}</p>
                <p className="opacity-80">
                  {day.status === 'none' ? 'No data' : day.status}
                </p>
                {day.incidentTitles.map((title) => (
                  <p key={title} className="opacity-80">
                    • {title}
                  </p>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function MonitorRow({ monitor }: { monitor: PublicMonitorView }) {
  return (
    <div className="py-4 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${statusDotClass(monitor.status)}`} />
          <span className="font-medium text-sm truncate">{monitor.name}</span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{monitor.uptime.toFixed(2)}% uptime</span>
      </div>
      <UptimeHeatmap monitor={monitor} />
    </div>
  );
}

function IncidentStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={
        status === 'Resolved'
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1.5'
          : status === 'Investigating'
            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20 gap-1.5'
            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20 gap-1.5'
      }
    >
      {status === 'Resolved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
      {status}
    </Badge>
  );
}

function IncidentCard({ incident }: { incident: PublicStatusPage['incidents'][number] }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-sm">{incident.title}</h3>
          {incident.monitorName && (
            <p className="text-xs text-muted-foreground mt-0.5">Affected: {incident.monitorName}</p>
          )}
        </div>
        <IncidentStatusBadge status={incident.status} />
      </div>
      <ol className="space-y-3 border-l pl-4">
        {incident.updates.map((update, i) => (
          <li key={i}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{update.status}</span>
              <span>{new Date(update.createdAt).toLocaleString()}</span>
            </div>
            <p className="text-sm mt-0.5 whitespace-pre-line">{update.message}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SubscribeForm({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const [channel, setChannel] = React.useState<SubscriberChannel>('Email');
  const [target, setTarget] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const subscribe = useMutation(
    trpc.statusPage.subscribe.mutationOptions({
      onSuccess: () => {
        setSuccess(true);
        setTarget('');
        setError(null);
      },
      onError: (err) => setError(err.message),
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setSuccess(false);
    subscribe.mutate({ slug, channel, target });
  };

  return (
    <div className="max-w-md space-y-4">
      <p className="text-sm text-muted-foreground">
        Get notified whenever an incident is reported or updated on this page.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-2">
          <Select
            value={channel}
            onValueChange={(val) => {
              if (val) {
                setChannel(val as SubscriberChannel);
                setError(null);
                setSuccess(false);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue>
                {(val: SubscriberChannel) => ({ Email: 'Email', Discord: 'Discord Webhook' })[val]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Email">Email</SelectItem>
              <SelectItem value="Discord">Discord Webhook</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder={channel === 'Email' ? 'you@example.com' : 'https://discord.com/api/webhooks/...'}
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setSuccess(false);
            }}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">You're subscribed!</p>}
        <Button type="submit" className="gap-2" disabled={subscribe.isPending}>
          {channel === 'Email' ? <Mail className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          {subscribe.isPending ? 'Subscribing…' : 'Subscribe'}
        </Button>
      </form>
    </div>
  );
}

function StatusPageBody({ slug, initialData }: StatusPageClientProps) {
  const trpc = useTRPC();

  const pageQuery = useQuery({
    ...trpc.statusPage.getPublicBySlug.queryOptions({ slug }),
    initialData,
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const page = pageQuery.data;
  const [lastUpdated, setLastUpdated] = React.useState(() => new Date());

  React.useEffect(() => {
    setLastUpdated(new Date());
  }, [page]);

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{ '--primary': page.primaryColor } as React.CSSProperties}
    >
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          {page.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{page.name}</h1>
            {page.description && <p className="text-sm text-muted-foreground">{page.description}</p>}
          </div>
        </div>

        <OverallBanner status={page.overallStatus} />

        <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className={`h-3 w-3 ${pageQuery.isFetching ? 'animate-spin' : ''}`} />
          Updated {lastUpdated.toLocaleTimeString()} · refreshes every minute
        </div>

        <Tabs defaultValue="uptime">
          <TabsList>
            <TabsTrigger value="uptime">Uptime</TabsTrigger>
            <TabsTrigger value="incidents">Incidents ({page.incidents.length})</TabsTrigger>
            <TabsTrigger value="subscribe">Subscribe</TabsTrigger>
          </TabsList>

          <TabsContent value="uptime" className="mt-6">
            {page.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No monitors on this page yet.</p>
            ) : (
              <div className="space-y-8">
                {page.groups.map((group) => (
                  <div key={group.id ?? 'ungrouped'}>
                    {group.name && (
                      <h2 className="text-sm font-semibold text-muted-foreground mb-1">{group.name}</h2>
                    )}
                    <div className="divide-y rounded-lg border px-4">
                      {group.monitors.map((monitor) => (
                        <MonitorRow key={monitor.id} monitor={monitor} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="incidents" className="mt-6">
            {page.incidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No incidents reported in the last {page.historyWindowDays} days.
              </p>
            ) : (
              <div className="space-y-4">
                {page.incidents.map((incident) => (
                  <IncidentCard key={incident.id} incident={incident} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="subscribe" className="mt-6">
            <SubscribeForm slug={slug} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default function StatusPageClient(props: StatusPageClientProps) {
  const forcedTheme = props.initialData.theme === 'system' ? undefined : props.initialData.theme;

  return (
    <NextThemesProvider attribute="class" forcedTheme={forcedTheme} enableSystem>
      <StatusPageBody {...props} />
    </NextThemesProvider>
  );
}
