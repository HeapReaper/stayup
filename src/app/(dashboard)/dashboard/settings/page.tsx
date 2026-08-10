'use client';

import * as React from 'react';
import {
  Mail,
  Sliders,
  Key,
  Save,
  Globe,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';

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

export default function SettingsPage() {
  const [isSaved, setIsSaved] = React.useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage global monitoring parameters, SMTP settings, API keys, and notifications.
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        {/* Navigation Tabs */}
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 lg:w-auto">
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
        </TabsList>

        {/* TAB 1: GENERAL */}
        <TabsContent value="general">
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
                <Input id="orgName" defaultValue="Acme Corp Monitoring" />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Select defaultValue="europe-amsterdam">
                  <SelectTrigger id="timezone">
                    <SelectValue>
                      {(val: string) =>
                        ({
                          'europe-amsterdam': 'Europe/Amsterdam (UTC+2)',
                          utc: 'UTC (Coordinated Universal Time)',
                          'america-new_york': 'America/New_York (EST)',
                        })[val] ?? val
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="europe-amsterdam">
                      Europe/Amsterdam (UTC+2)
                    </SelectItem>
                    <SelectItem value="utc">UTC (Coordinated Universal Time)</SelectItem>
                    <SelectItem value="america-new_york">
                      America/New_York (EST)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="supportEmail">Support / Admin Email</Label>
                <Input id="supportEmail" type="email" defaultValue="admin@acme.com" />
              </div>
            </CardContent>
            <CardFooter className="border-t px-6 py-4 flex justify-between items-center">
              <Button onClick={handleSave} className="gap-2">
                <Save className="h-4 w-4" /> Save Changes
              </Button>
              {isSaved && (
                <span className="text-xs text-emerald-500 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Settings saved successfully!
                </span>
              )}
            </CardFooter>
          </Card>
        </TabsContent>

        {/* TAB 2: MONITORING DEFAULTS */}
        <TabsContent value="monitoring">
          <Card>
            <CardHeader>
              <CardTitle>Default Monitoring Parameters</CardTitle>
              <CardDescription>
                Thresholds and rules for when a monitor is considered 'Down' or 'Degraded'.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="defaultCheckInterval">Default Check Interval</Label>
                  <Select defaultValue="60s">
                    <SelectTrigger id="defaultCheckInterval">
                      <SelectValue>
                        {(val: string) =>
                          ({
                            '15s': '15 seconds',
                            '30s': '30 seconds',
                            '60s': '60 seconds (1 min)',
                            '300s': '5 minutes',
                          })[val] ?? val
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15s">15 seconds</SelectItem>
                      <SelectItem value="30s">30 seconds</SelectItem>
                      <SelectItem value="60s">60 seconds (1 min)</SelectItem>
                      <SelectItem value="300s">5 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="timeout">HTTP Request Timeout (seconds)</Label>
                  <Input id="timeout" type="number" defaultValue={30} />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="retryCount">Failed Attempts Before Alert</Label>
                  <Input id="retryCount" type="number" defaultValue={3} />
                  <p className="text-xs text-muted-foreground">
                    Prevents false alarms caused by temporary blips.
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="latencyThreshold">Latency Threshold (ms)</Label>
                  <Input id="latencyThreshold" type="number" defaultValue={800} />
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
                      Automatically check for expired SSL certificates.
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-base">Certificate Expiry Warning</Label>
                    <p className="text-xs text-muted-foreground">
                      Send a notification when an SSL certificate expires within 14 days.
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </div>
            </CardContent>
            <CardFooter className="border-t px-6 py-4">
              <Button onClick={handleSave} className="gap-2">
                <Save className="h-4 w-4" /> Save Changes
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* TAB 3: SMTP & EMAIL */}
        <TabsContent value="smtp">
          <Card>
            <CardHeader>
              <CardTitle>SMTP Server Configuration</CardTitle>
              <CardDescription>
                Configure your outgoing mail server for sending alerts and invitations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 grid gap-2">
                  <Label htmlFor="smtpHost">SMTP Hostname</Label>
                  <Input id="smtpHost" placeholder="smtp.mailgun.org" defaultValue="smtp.sendgrid.net" />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="smtpPort">Port</Label>
                  <Input id="smtpPort" type="number" defaultValue={587} />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="smtpUser">Username / API Key</Label>
                  <Input id="smtpUser" defaultValue="apikey" />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="smtpPass">Password / Secret</Label>
                  <Input id="smtpPass" type="password" defaultValue="••••••••••••••••" />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="fromEmail">Sender Email (From Address)</Label>
                  <Input id="fromEmail" defaultValue="alerts@mycompany.com" />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="fromName">Sender Name</Label>
                  <Input id="fromName" defaultValue="Uptime Monitor Alerts" />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="space-y-0.5">
                  <Label>TLS/SSL Encryption</Label>
                  <p className="text-xs text-muted-foreground">
                    Recommended for secure email transmission (STARTTLS).
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
            <CardFooter className="border-t px-6 py-4 flex justify-between">
              <Button onClick={handleSave} className="gap-2">
                <Save className="h-4 w-4" /> Save Changes
              </Button>
              <Button variant="outline" onClick={() => alert('Test email sent to your email address!')} className="gap-2">
                <Mail className="h-4 w-4" /> Send Test Email
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* TAB 4: API & TOKENS */}
        <TabsContent value="api">
          <Card>
            <CardHeader>
              <CardTitle>API Key & Webhook Secrets</CardTitle>
              <CardDescription>
                Use API tokens to query tRPC/REST endpoints externally or connect your CI/CD pipelines.
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
                    defaultValue="up_live_99a8b7c6d5e4f3a2b1c0"
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" onClick={() => alert('API Key copied to clipboard!')}>
                    Copy
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
                  <Input
                    id="webhookSigning"
                    readOnly
                    defaultValue="whsec_X8f9A12B34C56D78E90F"
                    className="font-mono text-sm"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="border-t px-6 py-4 flex justify-between">
              <Button onClick={handleSave} className="gap-2">
                <Save className="h-4 w-4" /> Save Changes
              </Button>
              <Button variant="destructive" onClick={() => alert('New key generated!')} className="gap-2">
                <RefreshCw className="h-4 w-4" /> Regenerate Key
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}