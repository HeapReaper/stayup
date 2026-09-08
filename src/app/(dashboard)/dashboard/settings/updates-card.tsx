'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleArrowUp, ExternalLink, Package, RefreshCw, TriangleAlert } from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { UpdateStatusView } from '@/trpc/routers/update';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface UpdatesCardProps {
  initialStatus: UpdateStatusView;
  /** Checking and the daily-check toggle are Admin-only, like the rest of Settings. */
  canWrite: boolean;
}

/**
 * What each comparison actually means, in the operator's terms — the channel
 * isn't a setting, it's read off the image tag this container was built with
 * (see src/lib/updates.ts).
 */
const CHANNEL_COPY: Record<UpdateStatusView['channel'], string> = {
  release: 'Pinned to a release tag, so this is compared against the newest published release.',
  edge: 'Tracking `latest`, so this is compared against the newest commit on the default branch.',
  unknown:
    'This image was not stamped with a version by CI, so there is nothing to compare it against. Locally built images always look like this.',
};

function formatTimestamp(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

export default function UpdatesCard({ initialStatus, canWrite }: UpdatesCardProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({ ...trpc.update.status.queryOptions(), initialData: initialStatus });
  const status = statusQuery.data;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.update.status.queryKey() });

  const check = useMutation(trpc.update.check.mutationOptions({ onSuccess: invalidate }));
  const setAutoCheck = useMutation(trpc.update.setAutoCheck.mutationOptions({ onSuccess: invalidate }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Version & Updates</CardTitle>
        <CardDescription>
          Which build this instance is running, and whether a newer one has been published.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {status.updateAvailable ? (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
            <CircleArrowUp className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {status.latestVersion} is available — you are running {status.currentVersion}.
              </p>
              <p className="text-xs text-muted-foreground">
                StayUp does not update itself: a container cannot replace its own image. Pull the new
                images and recreate the stack:
              </p>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                <code>docker compose pull{'\n'}docker compose up -d</code>
              </pre>
              <p className="text-xs text-muted-foreground">
                On Coolify, press <span className="font-medium">Redeploy</span> instead. Pinned to a
                tag? Point <code className="font-mono">STAYUP_VERSION</code> at the new one first.
                The <code className="font-mono">web</code> container runs any pending database
                migrations on start.
              </p>
              {status.latestVersionUrl && (
                <a
                  href={status.latestVersionUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  What changed <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {status.channel === 'unknown'
                ? 'No update information for this build.'
                : 'No newer version found at the last check.'}
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Running</Label>
            <p className="flex items-center gap-2 font-mono text-sm">
              <Package className="h-4 w-4 text-muted-foreground" /> {status.currentVersion}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              revision {status.currentRevision}
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Latest published
            </Label>
            <p className="font-mono text-sm">{status.latestVersion ?? 'unknown'}</p>
            <p className="text-xs text-muted-foreground">
              {status.latestVersionPublishedAt
                ? `released ${formatTimestamp(status.latestVersionPublishedAt)}`
                : 'never checked'}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{CHANNEL_COPY[status.channel]}</p>

        {status.lastError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium">The last update check failed</p>
              <p className="text-xs text-muted-foreground">{status.lastError}</p>
            </div>
          </div>
        )}

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-base">Check automatically</Label>
            <p className="text-xs text-muted-foreground">
              The housekeeping worker asks once a day. Off, this instance only reaches out when you
              press the button below — it is the one outbound request StayUp makes that is not a
              monitor check or a notification.
            </p>
          </div>
          <Switch
            checked={status.updateCheckEnabled}
            disabled={!canWrite || setAutoCheck.isPending}
            onCheckedChange={(checked) => setAutoCheck.mutate({ enabled: checked })}
          />
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t px-6 py-4">
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={!canWrite || check.isPending}
          onClick={() => check.mutate()}
        >
          <RefreshCw className={`h-4 w-4 ${check.isPending ? 'animate-spin' : ''}`} />
          {check.isPending ? 'Checking…' : 'Check now'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Last checked: {formatTimestamp(status.lastCheckedAt)}
        </span>
      </CardFooter>
    </Card>
  );
}
