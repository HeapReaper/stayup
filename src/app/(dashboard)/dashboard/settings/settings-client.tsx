'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Mail,
  Sliders,
  Key,
  Save,
  Globe,
  RefreshCw,
  CheckCircle2,
  Copy,
  CircleArrowUp,
} from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import UpdatesCard from '@/app/(dashboard)/dashboard/settings/updates-card';
import type { AppSettingsView } from '@/trpc/routers/settings';
import type { UpdateStatusView } from '@/trpc/routers/update';
import type { MonitorInterval } from '@/trpc/routers/monitor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface SettingsClientPageProps {
  initialSettings: AppSettingsView;
  initialUpdateStatus: UpdateStatusView;
}

const TIMEZONE_LABELS: Record<string, string> = {
  utc: 'UTC (Coordinated Universal Time)',
  'europe-amsterdam': 'Europe/Amsterdam (UTC+2)',
  'america-new_york': 'America/New_York (EST)',
};

const INTERVAL_LABELS: Record<MonitorInterval, string> = {
  '15s': 'Every 15 sec',
  '30s': 'Every 30 sec',
  '60s': 'Every minute',
  '5m': 'Every 5 min',
};

function SavedBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="text-xs text-emerald-500 flex items-center gap-1 font-medium">
      <CheckCircle2 className="h-3.5 w-3.5" /> Saved successfully!
    </span>
  );
}

function useSavedFlash() {
  const [saved, setSaved] = React.useState(false);
  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };
  return { saved, flash };
}

export default function SettingsClientPage({
  initialSettings,
  initialUpdateStatus,
}: SettingsClientPageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({ ...trpc.settings.get.queryOptions(), initialData: initialSettings });
  const settings = settingsQuery.data;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.settings.get.queryKey() });

  // General
  const [general, setGeneral] = React.useState(() => ({
    organizationName: initialSettings.organizationName,
    timezone: initialSettings.timezone,
    supportEmail: initialSettings.supportEmail,
  }));
  const generalSaved = useSavedFlash();
  const [generalError, setGeneralError] = React.useState<string | null>(null);

  const updateGeneral = useMutation(
    trpc.settings.updateGeneral.mutationOptions({
      onSuccess: (result) => {
        setGeneral({ organizationName: result.organizationName, timezone: result.timezone, supportEmail: result.supportEmail });
        invalidate();
        generalSaved.flash();
        setGeneralError(null);
      },
      onError: (error) => setGeneralError(error.message),
    }),
  );

  // Monitoring defaults
  const [monitoring, setMonitoring] = React.useState(() => ({
    defaultCheckInterval: initialSettings.defaultCheckInterval as MonitorInterval,
    httpTimeoutSeconds: initialSettings.httpTimeoutSeconds,
    failedAttemptsThreshold: initialSettings.failedAttemptsThreshold,
    latencyThresholdMs: initialSettings.latencyThresholdMs,
    sslCheckEnabled: initialSettings.sslCheckEnabled,
    certExpiryWarningEnabled: initialSettings.certExpiryWarningEnabled,
    certExpiryWarningDays: initialSettings.certExpiryWarningDays,
    checkRetentionDays: initialSettings.checkRetentionDays,
    deliveryRetentionDays: initialSettings.deliveryRetentionDays,
  }));
  const monitoringSaved = useSavedFlash();

  const updateMonitoring = useMutation(
    trpc.settings.updateMonitoring.mutationOptions({
      onSuccess: (result) => {
        setMonitoring({
          defaultCheckInterval: result.defaultCheckInterval as MonitorInterval,
          httpTimeoutSeconds: result.httpTimeoutSeconds,
          failedAttemptsThreshold: result.failedAttemptsThreshold,
          latencyThresholdMs: result.latencyThresholdMs,
          sslCheckEnabled: result.sslCheckEnabled,
          certExpiryWarningEnabled: result.certExpiryWarningEnabled,
          certExpiryWarningDays: result.certExpiryWarningDays,
          checkRetentionDays: result.checkRetentionDays,
          deliveryRetentionDays: result.deliveryRetentionDays,
        });
        invalidate();
        monitoringSaved.flash();
      },
    }),
  );

  // SMTP
  const [smtp, setSmtp] = React.useState(() => ({
    smtpHost: initialSettings.smtpHost,
    smtpPort: initialSettings.smtpPort,
    smtpUser: initialSettings.smtpUser,
    smtpPass: '', // never sent back down; blank means "keep existing"
    smtpFromEmail: initialSettings.smtpFromEmail,
    smtpFromName: initialSettings.smtpFromName,
    smtpUseTls: initialSettings.smtpUseTls,
  }));
  const smtpSaved = useSavedFlash();
  const [smtpError, setSmtpError] = React.useState<string | null>(null);
  const [testEmailStatus, setTestEmailStatus] = React.useState<string | null>(null);

  const updateSmtp = useMutation(
    trpc.settings.updateSmtp.mutationOptions({
      onSuccess: () => {
        setSmtp((prev) => ({ ...prev, smtpPass: '' }));
        invalidate();
        smtpSaved.flash();
        setSmtpError(null);
      },
      onError: (error) => setSmtpError(error.message),
    }),
  );

  const sendTestEmail = useMutation(
    trpc.settings.sendTestEmail.mutationOptions({
      onSuccess: () => setTestEmailStatus('Test email sent — check your inbox!'),
      onError: (error) => setTestEmailStatus(error.message),
    }),
  );

  React.useEffect(() => {
    if (!testEmailStatus) return;
    const timer = setTimeout(() => setTestEmailStatus(null), 6000);
    return () => clearTimeout(timer);
  }, [testEmailStatus]);

  // API & tokens
  const [copyFeedback, setCopyFeedback] = React.useState<string | null>(null);

  const regenerateApiKey = useMutation(
    trpc.settings.regenerateApiKey.mutationOptions({ onSuccess: () => invalidate() }),
  );
  const regenerateWebhookSecret = useMutation(
    trpc.settings.regenerateWebhookSecret.mutationOptions({ onSuccess: () => invalidate() }),
  );

  const copyToClipboard = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(`${label} copied to clipboard!`);
    } catch {
      setCopyFeedback(null);
    }
    setTimeout(() => setCopyFeedback(null), 3000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage global monitoring parameters, SMTP settings, API keys, and notifications.
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 lg:w-auto">
          <TabsTrigger value="general" className="gap-2">
            <Globe className="h-4 w-4" /> General
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="gap-2">
            <Sliders className="h-4 w-4" /> Monitoring Defaults
          </TabsTrigger>
          <TabsTrigger value="smtp" className="gap-2">
            <Mail className="h-4 w-4" /> SMTP & Email
          </TabsTrigger>
          <TabsTrigger value="api" className="gap-2">
            <Key className="h-4 w-4" /> API & Tokens
          </TabsTrigger>
          <TabsTrigger value="updates" className="gap-2">
            <CircleArrowUp className="h-4 w-4" /> Updates
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: GENERAL */}
        <TabsContent value="general">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateGeneral.mutate(general);
            }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Organization Settings</CardTitle>
                <CardDescription>
                  Update general information regarding your monitoring instance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="orgName">Organization Name</Label>
                  <Input
                    id="orgName"
                    value={general.organizationName}
                    onChange={(e) => setGeneral({ ...general, organizationName: e.target.value })}
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select
                    value={general.timezone}
                    onValueChange={(val) => {
                      if (val) setGeneral({ ...general, timezone: val });
                    }}
                  >
                    <SelectTrigger id="timezone">
                      <SelectValue>{(val: string) => TIMEZONE_LABELS[val] ?? val}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="europe-amsterdam">Europe/Amsterdam (UTC+2)</SelectItem>
                      <SelectItem value="utc">UTC (Coordinated Universal Time)</SelectItem>
                      <SelectItem value="america-new_york">America/New_York (EST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="supportEmail">Support / Admin Email</Label>
                  <Input
                    id="supportEmail"
                    type="email"
                    placeholder="admin@example.com"
                    value={general.supportEmail}
                    onChange={(e) => setGeneral({ ...general, supportEmail: e.target.value })}
                  />
                </div>

                {generalError && <p className="text-sm text-destructive">{generalError}</p>}
              </CardContent>
              <CardFooter className="border-t px-6 py-4 flex justify-between items-center">
                <Button type="submit" className="gap-2" disabled={updateGeneral.isPending}>
                  <Save className="h-4 w-4" /> {updateGeneral.isPending ? 'Saving…' : 'Save Changes'}
                </Button>
                <SavedBadge show={generalSaved.saved} />
              </CardFooter>
            </Card>
          </form>
        </TabsContent>

        {/* TAB 2: MONITORING DEFAULTS */}
        <TabsContent value="monitoring">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateMonitoring.mutate(monitoring);
            }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Default Monitoring Parameters</CardTitle>
                <CardDescription>
                  Thresholds and rules for when a monitor is considered 'Down' or 'Degraded'. Read live by
                  every monitor-check worker on every check — changes here apply on the next check, no
                  restart needed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="defaultCheckInterval">Default Check Interval</Label>
                    <Select
                      value={monitoring.defaultCheckInterval}
                      onValueChange={(val) => {
                        if (val) setMonitoring({ ...monitoring, defaultCheckInterval: val as MonitorInterval });
                      }}
                    >
                      <SelectTrigger id="defaultCheckInterval">
                        <SelectValue>{(val: MonitorInterval) => INTERVAL_LABELS[val]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15s">Every 15 sec</SelectItem>
                        <SelectItem value="30s">Every 30 sec</SelectItem>
                        <SelectItem value="60s">Every minute</SelectItem>
                        <SelectItem value="5m">Every 5 min</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="timeout">Request Timeout (seconds)</Label>
                    <Input
                      id="timeout"
                      type="number"
                      min={1}
                      max={300}
                      value={monitoring.httpTimeoutSeconds}
                      onChange={(e) =>
                        setMonitoring({ ...monitoring, httpTimeoutSeconds: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="retryCount">Failed Attempts Before Alert</Label>
                    <Input
                      id="retryCount"
                      type="number"
                      min={1}
                      max={20}
                      value={monitoring.failedAttemptsThreshold}
                      onChange={(e) =>
                        setMonitoring({ ...monitoring, failedAttemptsThreshold: Number(e.target.value) })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      How many checks in a row must fail before a monitor is marked down and an
                      incident opens. Raise this to stop one-off blips from alerting; every
                      individual failure is still recorded and still counts against uptime.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="latencyThreshold">Latency Threshold (ms)</Label>
                    <Input
                      id="latencyThreshold"
                      type="number"
                      min={50}
                      max={60000}
                      value={monitoring.latencyThresholdMs}
                      onChange={(e) =>
                        setMonitoring({ ...monitoring, latencyThresholdMs: Number(e.target.value) })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Response times exceeding this value will be marked as 'Degraded'.
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base">SSL/TLS Certificate Check</Label>
                      <p className="text-xs text-muted-foreground">
                        Verify certificates on HTTPS monitors. Turn this off to monitor hosts with
                        self-signed or internal-CA certificates, which would otherwise fail every check.
                      </p>
                    </div>
                    <Switch
                      checked={monitoring.sslCheckEnabled}
                      onCheckedChange={(checked) => setMonitoring({ ...monitoring, sslCheckEnabled: checked })}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <Label className="text-base">Certificate Expiry Warning</Label>
                      <p className="text-xs text-muted-foreground">
                        Mark an HTTPS monitor 'Degraded' — which opens an incident and notifies your
                        integrations — once its certificate is this close to expiring.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Input
                        id="certExpiryWarningDays"
                        type="number"
                        min={1}
                        max={365}
                        className="w-20"
                        aria-label="Days before expiry"
                        disabled={!monitoring.certExpiryWarningEnabled}
                        value={monitoring.certExpiryWarningDays}
                        onChange={(e) =>
                          setMonitoring({ ...monitoring, certExpiryWarningDays: Number(e.target.value) })
                        }
                      />
                      <span className="text-xs text-muted-foreground">days</span>
                      <Switch
                        checked={monitoring.certExpiryWarningEnabled}
                        onCheckedChange={(checked) =>
                          setMonitoring({ ...monitoring, certExpiryWarningEnabled: checked })
                        }
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="space-y-0.5">
                    <Label className="text-base">Data Retention</Label>
                    <p className="text-xs text-muted-foreground">
                      Enforced once a day by the janitor worker. Daily uptime summaries are kept forever,
                      so status-page history survives long after the individual checks behind it are gone.
                    </p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="checkRetentionDays">Keep Individual Checks (days)</Label>
                      <Input
                        id="checkRetentionDays"
                        type="number"
                        min={1}
                        max={3650}
                        value={monitoring.checkRetentionDays}
                        onChange={(e) =>
                          setMonitoring({ ...monitoring, checkRetentionDays: Number(e.target.value) })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        A monitor on a 15-second interval writes about 5,800 checks a day. Below 30
                        days, a monitor's uptime percentage covers only the checks that are left.
                      </p>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="deliveryRetentionDays">Keep Notification Log (days)</Label>
                      <Input
                        id="deliveryRetentionDays"
                        type="number"
                        min={1}
                        max={3650}
                        value={monitoring.deliveryRetentionDays}
                        onChange={(e) =>
                          setMonitoring({ ...monitoring, deliveryRetentionDays: Number(e.target.value) })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Only delivered and failed notifications are removed; anything still pending is kept.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="border-t px-6 py-4 flex justify-between items-center">
                <Button type="submit" className="gap-2" disabled={updateMonitoring.isPending}>
                  <Save className="h-4 w-4" /> {updateMonitoring.isPending ? 'Saving…' : 'Save Changes'}
                </Button>
                <SavedBadge show={monitoringSaved.saved} />
              </CardFooter>
            </Card>
          </form>
        </TabsContent>

        {/* TAB 3: SMTP & EMAIL */}
        <TabsContent value="smtp">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateSmtp.mutate({ ...smtp, smtpPort: smtp.smtpPort ?? undefined });
            }}
          >
            <Card>
              <CardHeader>
                <CardTitle>SMTP Server Configuration</CardTitle>
                <CardDescription>
                  Configure your outgoing mail server for reference. Note: actual outgoing email still uses
                  the SMTP_* variables in your .env — this tab persists what you enter, but doesn't hot-swap
                  the already-initialized mail transporter (see src/lib/email.ts).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2 grid gap-2">
                    <Label htmlFor="smtpHost">SMTP Hostname</Label>
                    <Input
                      id="smtpHost"
                      placeholder="smtp.mailgun.org"
                      value={smtp.smtpHost}
                      onChange={(e) => setSmtp({ ...smtp, smtpHost: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="smtpPort">Port</Label>
                    <Input
                      id="smtpPort"
                      type="number"
                      value={smtp.smtpPort ?? ''}
                      onChange={(e) => setSmtp({ ...smtp, smtpPort: e.target.value ? Number(e.target.value) : null })}
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="smtpUser">Username / API Key</Label>
                    <Input
                      id="smtpUser"
                      value={smtp.smtpUser}
                      onChange={(e) => setSmtp({ ...smtp, smtpUser: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="smtpPass">Password / Secret</Label>
                    <Input
                      id="smtpPass"
                      type="password"
                      placeholder={settings.smtpPassSet ? 'Leave blank to keep the current secret' : '••••••••'}
                      value={smtp.smtpPass}
                      onChange={(e) => setSmtp({ ...smtp, smtpPass: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="fromEmail">Sender Email (From Address)</Label>
                    <Input
                      id="fromEmail"
                      value={smtp.smtpFromEmail}
                      onChange={(e) => setSmtp({ ...smtp, smtpFromEmail: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="fromName">Sender Name</Label>
                    <Input
                      id="fromName"
                      value={smtp.smtpFromName}
                      onChange={(e) => setSmtp({ ...smtp, smtpFromName: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="space-y-0.5">
                    <Label>TLS/SSL Encryption</Label>
                    <p className="text-xs text-muted-foreground">
                      Recommended for secure email transmission (STARTTLS).
                    </p>
                  </div>
                  <Switch
                    checked={smtp.smtpUseTls}
                    onCheckedChange={(checked) => setSmtp({ ...smtp, smtpUseTls: checked })}
                  />
                </div>

                {smtpError && <p className="text-sm text-destructive">{smtpError}</p>}
                {testEmailStatus && <p className="text-sm text-muted-foreground">{testEmailStatus}</p>}
              </CardContent>
              <CardFooter className="border-t px-6 py-4 flex justify-between items-center flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <Button type="submit" className="gap-2" disabled={updateSmtp.isPending}>
                    <Save className="h-4 w-4" /> {updateSmtp.isPending ? 'Saving…' : 'Save Changes'}
                  </Button>
                  <SavedBadge show={smtpSaved.saved} />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => sendTestEmail.mutate()}
                  disabled={sendTestEmail.isPending}
                >
                  <Mail className="h-4 w-4" /> {sendTestEmail.isPending ? 'Sending…' : 'Send Test Email'}
                </Button>
              </CardFooter>
            </Card>
          </form>
        </TabsContent>

        {/* TAB 4: API & TOKENS */}
        <TabsContent value="api">
          <Card>
            <CardHeader>
              <CardTitle>API Key & Webhook Secrets</CardTitle>
              <CardDescription>
                Reference tokens for your own scripts/integrations. Keep them secret.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-2">
                <Label htmlFor="apiKey">Live API Key</Label>
                <div className="flex gap-2">
                  <Input
                    id="apiKey"
                    readOnly
                    type="password"
                    value={settings.apiKey}
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => copyToClipboard('API Key', settings.apiKey)}
                  >
                    <Copy className="h-4 w-4" /> Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Keep this key secret. Never expose this key in public repositories.
                </p>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="text-sm font-semibold">Incoming Webhook Secrets</h4>
                <div className="grid gap-2">
                  <Label htmlFor="webhookSigning">Webhook Signing Secret</Label>
                  <div className="flex gap-2">
                    <Input
                      id="webhookSigning"
                      readOnly
                      type="password"
                      value={settings.webhookSigningSecret}
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={() => copyToClipboard('Webhook secret', settings.webhookSigningSecret)}
                    >
                      <Copy className="h-4 w-4" /> Copy
                    </Button>
                  </div>
                </div>
              </div>

              {copyFeedback && <p className="text-xs text-emerald-600 dark:text-emerald-400">{copyFeedback}</p>}
            </CardContent>
            <CardFooter className="border-t px-6 py-4 flex justify-between flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                className="gap-2"
                onClick={() => regenerateApiKey.mutate()}
                disabled={regenerateApiKey.isPending}
              >
                <RefreshCw className="h-4 w-4" /> Regenerate API Key
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="gap-2"
                onClick={() => regenerateWebhookSecret.mutate()}
                disabled={regenerateWebhookSecret.isPending}
              >
                <RefreshCw className="h-4 w-4" /> Regenerate Webhook Secret
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* TAB 5: UPDATES */}
        <TabsContent value="updates">
          <UpdatesCard initialStatus={initialUpdateStatus} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
