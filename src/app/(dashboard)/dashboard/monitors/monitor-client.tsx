'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  X,
  Tag as TagIcon,
  Pause,
  Play,
  ShieldAlert,
  Activity,
} from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { Monitor } from '@/trpc/routers/monitor';
import {
  PROBE_TYPES,
  DEFAULT_PORTS,
  dnsRecordTypeEnum,
  monitorTypeEnum,
  type DnsRecordType,
  type MonitorType,
  type MonitorInterval,
  type MonitorMethod,
} from '@/lib/monitor-types';
import type { AssertionType } from '@/lib/assertions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

interface MonitorsClientPageProps {
  initialMonitors: Monitor[];
}

// Sentinel for the "no escalation policy" Select option — mirrors NO_MONITOR
// in incidents-client.tsx (Base UI's Select can't use an empty string value).
const NO_ESCALATION_POLICY = 'none';

type MonitorFormState = {
  name: string;
  url: string;
  type: MonitorType;
  interval: MonitorInterval;
  port: string;
  tags: string[];
  escalationPolicyId: string;
  // HTTP-only; kept in the form for every type (the server blanks them out
  // for Ping/Port/DNS) so switching type back and forth doesn't lose input.
  method: MonitorMethod;
  requestHeaders: string;
  requestBody: string;
  followRedirects: boolean;
  expectedStatusCodes: string;
  keyword: string;
  keywordInverted: boolean;
  assertionType: AssertionType;
  jsonPath: string;
  // DNS-only, same deal: the server blanks them out for every other type.
  dnsRecordType: DnsRecordType;
  dnsExpectedValue: string;
  // Write-only: never sent back down, blank means "keep the stored secret".
  credential: string;
  sloTarget: string;
  // Per-monitor overrides. Blank = "use the instance default from Settings".
  httpTimeoutSeconds: string;
  failedAttemptsThreshold: string;
  latencyThresholdMs: string;
};

// Base UI's <SelectValue> only resolves a label once its item list has
// mounted at least once (it's portaled/lazy); until then it falls back to
// showing the raw value. Passing these maps as SelectValue's children avoids
// that — see https://base-ui.com/react/components/select#value.
const MONITOR_TYPE_LABELS: Record<MonitorType, string> = {
  HTTP: 'HTTP(s)',
  Ping: 'Ping',
  Port: 'Port',
  DNS: 'DNS',
  Postgres: 'PostgreSQL',
  MySQL: 'MySQL',
  Redis: 'Redis',
  SMTP: 'SMTP',
  IMAP: 'IMAP',
  gRPC: 'gRPC',
  WebSocket: 'WebSocket',
  Domain: 'Domain expiry',
};

/** What the URL/host field means per type — it is not always a URL. */
const TARGET_LABELS: Partial<Record<MonitorType, { label: string; placeholder: string; hint?: string }>> = {
  DNS: {
    label: 'Hostname',
    placeholder: 'example.com',
    hint: 'The name that is looked up. For SRV, write it out in full: _sip._tcp.example.com.',
  },
  Postgres: {
    label: 'Connection string',
    placeholder: 'postgresql://user@db.internal:5432/appdb',
    hint: 'The check connects and runs SELECT 1. Leave the password out and put it below.',
  },
  MySQL: {
    label: 'Host or connection string',
    placeholder: 'db.internal',
    hint: 'A host reads the server handshake — no credentials needed. Give mysql://user@db.internal:3306/appdb instead and the check logs in and runs SELECT 1.',
  },
  Redis: { label: 'Host', placeholder: 'cache.internal', hint: 'Sends PING and expects PONG.' },
  SMTP: { label: 'Host', placeholder: 'mail.example.com', hint: 'Greeting, EHLO, NOOP, QUIT. Port 465 uses implicit TLS.' },
  IMAP: { label: 'Host', placeholder: 'mail.example.com', hint: 'Reads the * OK greeting. Port 993 uses implicit TLS.' },
  gRPC: {
    label: 'Target',
    placeholder: 'grpc://service.internal',
    hint: 'Calls grpc.health.v1.Health/Check. Use grpcs:// for TLS.',
  },
  WebSocket: { label: 'URL', placeholder: 'wss://example.com/socket', hint: 'Performs the RFC 6455 upgrade handshake.' },
  Domain: {
    label: 'Domain name',
    placeholder: 'example.com',
    hint: 'Looks the registry expiry up over RDAP. Use a slow interval — RDAP servers are rate-limited.',
  },
};

/** Types whose check takes an optional password (stored write-only). */
const CREDENTIAL_TYPES: MonitorType[] = ['Postgres', 'MySQL', 'Redis'];

const MONITOR_INTERVAL_LABELS: Record<MonitorInterval, string> = {
  '15s': 'Every 15 sec',
  '30s': 'Every 30 sec',
  '60s': 'Every minute',
  '5m': 'Every 5 min',
  '1h': 'Every hour',
  '12h': 'Every 12 hours',
  '24h': 'Once a day',
};

const ASSERTION_LABELS: Record<AssertionType, string> = {
  Contains: 'Body contains',
  Regex: 'Body matches regex',
  JsonPath: 'JSON path equals',
};

function emptyForm(): MonitorFormState {
  return {
    name: '',
    url: '',
    type: 'HTTP',
    interval: '60s',
    port: '',
    tags: [],
    escalationPolicyId: NO_ESCALATION_POLICY,
    method: 'GET',
    requestHeaders: '',
    requestBody: '',
    followRedirects: true,
    expectedStatusCodes: '',
    keyword: '',
    keywordInverted: false,
    assertionType: 'Contains',
    jsonPath: '',
    dnsRecordType: 'A',
    dnsExpectedValue: '',
    credential: '',
    sloTarget: '',
    httpTimeoutSeconds: '',
    failedAttemptsThreshold: '',
    latencyThresholdMs: '',
  };
}

function monitorToForm(monitor: Monitor): MonitorFormState {
  return {
    name: monitor.name,
    url: monitor.url,
    type: monitor.type,
    interval: monitor.interval,
    port: monitor.port ? String(monitor.port) : '',
    tags: monitor.tags.map((tag) => tag.name),
    escalationPolicyId: monitor.escalationPolicyId ?? NO_ESCALATION_POLICY,
    method: monitor.method,
    requestHeaders: monitor.requestHeaders ?? '',
    requestBody: monitor.requestBody ?? '',
    followRedirects: monitor.followRedirects,
    expectedStatusCodes: monitor.expectedStatusCodes ?? '',
    keyword: monitor.keyword ?? '',
    keywordInverted: monitor.keywordInverted,
    assertionType: monitor.assertionType,
    jsonPath: monitor.jsonPath ?? '',
    dnsRecordType: monitor.dnsRecordType,
    dnsExpectedValue: monitor.dnsExpectedValue ?? '',
    credential: '',
    sloTarget: monitor.sloTarget === null ? '' : String(monitor.sloTarget),
    httpTimeoutSeconds: monitor.httpTimeoutSeconds === null ? '' : String(monitor.httpTimeoutSeconds),
    failedAttemptsThreshold:
      monitor.failedAttemptsThreshold === null ? '' : String(monitor.failedAttemptsThreshold),
    latencyThresholdMs: monitor.latencyThresholdMs === null ? '' : String(monitor.latencyThresholdMs),
  };
}

function formatLastChecked(date: Date | string | null) {
  if (!date) return 'Never checked';
  return new Date(date).toLocaleString();
}

// Only surfaced once it's close enough to act on — a certificate with months
// left is noise in a table you scan for outages.
const CERT_EXPIRY_NOTICE_DAYS = 30;

function certExpiryNotice(certExpiresAt: string | null): string | null {
  return expiryNotice(certExpiresAt, 'Certificate', CERT_EXPIRY_NOTICE_DAYS);
}

// Same treatment for a Domain monitor's registry expiry: a lapsed domain is
// as fatal as a lapsed certificate, and renewal windows are longer.
const DOMAIN_EXPIRY_NOTICE_DAYS = 60;

function domainExpiryNotice(domainExpiresAt: string | null): string | null {
  return expiryNotice(domainExpiresAt, 'Domain', DOMAIN_EXPIRY_NOTICE_DAYS);
}

function expiryNotice(expiresAt: string | null, subject: string, withinDays: number): string | null {
  if (!expiresAt) return null;

  const days = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days > withinDays) return null;
  if (days < 0) return `${subject} expired`;
  if (days === 0) return `${subject} expires today`;
  return `${subject} expires in ${days} day${days === 1 ? '' : 's'}`;
}

export default function MonitorsClientPage({ initialMonitors }: MonitorsClientPageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const monitorsQuery = useQuery({
    ...trpc.monitor.getAll.queryOptions(),
    initialData: initialMonitors,
  });
  const monitors = monitorsQuery.data;

  const tagsQuery = useQuery(trpc.tag.getAll.queryOptions());
  const knownTags = tagsQuery.data ?? [];

  const escalationPoliciesQuery = useQuery(trpc.escalationPolicy.getAll.queryOptions());
  const escalationPolicies = escalationPoliciesQuery.data ?? [];

  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<MonitorFormState>(emptyForm());
  const [formError, setFormError] = React.useState<string | null>(null);
  const [tagDraft, setTagDraft] = React.useState('');

  const invalidateMonitors = () =>
    queryClient.invalidateQueries({ queryKey: trpc.monitor.getAll.queryKey() });

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setTagDraft('');
  };

  const createMonitor = useMutation(
    trpc.monitor.create.mutationOptions({
      onSuccess: () => {
        invalidateMonitors();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const updateMonitor = useMutation(
    trpc.monitor.update.mutationOptions({
      onSuccess: () => {
        invalidateMonitors();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const deleteMonitor = useMutation(
    trpc.monitor.delete.mutationOptions({
      onSuccess: () => invalidateMonitors(),
    }),
  );

  const setMonitorEnabled = useMutation(
    trpc.monitor.setEnabled.mutationOptions({
      onSuccess: () => invalidateMonitors(),
    }),
  );

  // Filter by search query & status tab
  const filteredMonitors = monitors.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.url.toLowerCase().includes(searchQuery.toLowerCase());

    // A paused monitor keeps its last known status, so it would otherwise
    // still show up under Up/Down — it belongs in exactly one tab.
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'paused'
          ? !m.enabled
          : m.enabled && m.status.toLowerCase() === statusFilter.toLowerCase();

    return matchesSearch && matchesStatus;
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (monitor: Monitor) => {
    setEditingId(monitor.id);
    setForm(monitorToForm(monitor));
    setFormError(null);
    setTagDraft('');
    setIsFormOpen(true);
  };

  const addTag = (rawName: string) => {
    const name = rawName.trim();
    if (!name || form.tags.includes(name)) return;
    setForm((prev) => ({ ...prev, tags: [...prev.tags, name] }));
    setTagDraft('');
  };

  const removeTag = (name: string) => {
    setForm((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== name) }));
  };

  const tagSuggestions = knownTags
    .map((t) => t.name)
    .filter(
      (name) =>
        tagDraft.trim().length > 0 &&
        name.toLowerCase().includes(tagDraft.trim().toLowerCase()) &&
        !form.tags.includes(name),
    )
    .slice(0, 5);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.url) return;

    const payload = {
      name: form.name,
      url: form.url,
      type: form.type,
      interval: form.interval,
      port: form.port ? Number(form.port) : undefined,
      tagNames: form.tags,
      escalationPolicyId: form.escalationPolicyId === NO_ESCALATION_POLICY ? null : form.escalationPolicyId,
      method: form.method,
      requestHeaders: form.requestHeaders,
      requestBody: form.requestBody,
      followRedirects: form.followRedirects,
      expectedStatusCodes: form.expectedStatusCodes,
      keyword: form.keyword,
      keywordInverted: form.keywordInverted,
      assertionType: form.assertionType,
      jsonPath: form.jsonPath,
      dnsRecordType: form.dnsRecordType,
      dnsExpectedValue: form.dnsExpectedValue,
      credential: form.credential,
      sloTarget: form.sloTarget ? Number(form.sloTarget) : null,
      httpTimeoutSeconds: form.httpTimeoutSeconds ? Number(form.httpTimeoutSeconds) : null,
      failedAttemptsThreshold: form.failedAttemptsThreshold ? Number(form.failedAttemptsThreshold) : null,
      latencyThresholdMs: form.latencyThresholdMs ? Number(form.latencyThresholdMs) : null,
    };

    if (editingId) {
      updateMonitor.mutate({ id: editingId, ...payload });
    } else {
      createMonitor.mutate(payload);
    }
  };

  const handleDeleteMonitor = (id: string) => {
    deleteMonitor.mutate({ id });
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard access can be denied by the browser; nothing to recover from here.
    }
  };

  const isSaving = createMonitor.isPending || updateMonitor.isPending;

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Monitors</h1>
          <p className="text-sm text-muted-foreground">
            Manage and view the status and response times of all your endpoints.
          </p>
        </div>

        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Monitor
        </Button>
      </div>

      {/* Add/Edit Sheet */}
      <Sheet
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <SheetContent side="right" className="sm:max-w-md w-full">
          <SheetHeader>
            <SheetTitle>{editingId ? 'Edit Monitor' : 'Add New Monitor'}</SheetTitle>
            <SheetDescription>
              Configure an endpoint to continuously test availability and performance.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Ex. Production API"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="url">{TARGET_LABELS[form.type]?.label ?? 'URL, host or IP address'}</Label>
                <Input
                  id="url"
                  placeholder={TARGET_LABELS[form.type]?.placeholder ?? 'https://api.example.com/health'}
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  required
                />
                {TARGET_LABELS[form.type]?.hint && (
                  <p className="text-xs text-muted-foreground">{TARGET_LABELS[form.type]?.hint}</p>
                )}
              </div>

              {(form.type === 'Port' || PROBE_TYPES.includes(form.type)) && form.type !== 'Domain' && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="port">Port</Label>
                    <Input
                      id="port"
                      type="number"
                      min={1}
                      max={65535}
                      placeholder={DEFAULT_PORTS[form.type] ? String(DEFAULT_PORTS[form.type]) : '80'}
                      value={form.port}
                      onChange={(e) => setForm({ ...form, port: e.target.value })}
                      required={form.type === 'Port'}
                    />
                    {form.type !== 'Port' && DEFAULT_PORTS[form.type] && (
                      <p className="text-xs text-muted-foreground">
                        Leave blank for the default ({DEFAULT_PORTS[form.type]}).
                      </p>
                    )}
                  </div>

                  {CREDENTIAL_TYPES.includes(form.type) && (
                    <div className="grid gap-2">
                      <Label htmlFor="credential">Password</Label>
                      <Input
                        id="credential"
                        type="password"
                        placeholder={
                          editingId && monitors.find((m) => m.id === editingId)?.credentialSet
                            ? 'Leave blank to keep the current secret'
                            : 'Optional'
                        }
                        value={form.credential}
                        onChange={(e) => setForm({ ...form, credential: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Stored write-only; never sent back to the browser.</p>
                    </div>
                  )}
                </div>
              )}

              {form.type === 'DNS' && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="dnsRecordType">Record type</Label>
                    <Select
                      value={form.dnsRecordType}
                      onValueChange={(val) => {
                        if (val) setForm({ ...form, dnsRecordType: val as DnsRecordType });
                      }}
                    >
                      <SelectTrigger id="dnsRecordType">
                        <SelectValue>{(val: DnsRecordType) => val}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {dnsRecordTypeEnum.options.map((record) => (
                          <SelectItem key={record} value={record}>
                            {record}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="dnsExpectedValue">Expected value</Label>
                    <Input
                      id="dnsExpectedValue"
                      placeholder="Ex. mail.protection.outlook.com"
                      value={form.dnsExpectedValue}
                      onChange={(e) => setForm({ ...form, dnsExpectedValue: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional, matched case-insensitively anywhere in the answer. Blank checks only that the
                      record still resolves.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(val) => {
                      if (val) setForm({ ...form, type: val as MonitorType });
                    }}
                  >
                    <SelectTrigger id="type">
                      <SelectValue>{(val: MonitorType) => MONITOR_TYPE_LABELS[val]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {monitorTypeEnum.options.map((type) => (
                        <SelectItem key={type} value={type}>
                          {MONITOR_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="interval">Interval</Label>
                  <Select
                    value={form.interval}
                    onValueChange={(val) => {
                      if (val) setForm({ ...form, interval: val as MonitorInterval });
                    }}
                  >
                    <SelectTrigger id="interval">
                      <SelectValue>{(val: MonitorInterval) => MONITOR_INTERVAL_LABELS[val]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15s">Every 15 sec</SelectItem>
                      <SelectItem value="30s">Every 30 sec</SelectItem>
                      <SelectItem value="60s">Every minute</SelectItem>
                      <SelectItem value="5m">Every 5 min</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tags">Tags</Label>
                <div className="flex flex-wrap gap-1.5 rounded-md border p-2 min-h-9">
                  {form.tags.map((name) => (
                    <Badge key={name} variant="secondary" className="gap-1 pr-1">
                      {name}
                      <button
                        type="button"
                        onClick={() => removeTag(name)}
                        className="rounded-full hover:bg-muted-foreground/20"
                      >
                        <X className="h-3 w-3" />
                        <span className="sr-only">Remove {name}</span>
                      </button>
                    </Badge>
                  ))}
                  <input
                    id="tags"
                    className="flex-1 min-w-24 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    placeholder={form.tags.length === 0 ? 'production, third-party…' : ''}
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTag(tagDraft);
                      } else if (e.key === 'Backspace' && tagDraft === '' && form.tags.length > 0) {
                        removeTag(form.tags[form.tags.length - 1]);
                      }
                    }}
                  />
                </div>
                {tagSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tagSuggestions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => addTag(name)}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                      >
                        <TagIcon className="h-3 w-3" />
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {form.type === 'HTTP' && (
                <div className="grid gap-4 rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Request &amp; assertions</Label>
                    <p className="text-xs text-muted-foreground">
                      Leave these alone for a plain availability check: a GET that counts any 2xx as up.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="method">Method</Label>
                      <Select
                        value={form.method}
                        onValueChange={(val) => {
                          if (val) setForm({ ...form, method: val as MonitorMethod });
                        }}
                      >
                        <SelectTrigger id="method">
                          <SelectValue>{(val: MonitorMethod) => val}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((method) => (
                            <SelectItem key={method} value={method}>
                              {method}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="expectedStatusCodes">Expected status</Label>
                      <Input
                        id="expectedStatusCodes"
                        placeholder="Any 2xx"
                        value={form.expectedStatusCodes}
                        onChange={(e) => setForm({ ...form, expectedStatusCodes: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="assertionType">Response assertion</Label>
                    <div className="flex items-center gap-2">
                      <Select
                        value={form.assertionType}
                        onValueChange={(val) => {
                          if (val) setForm({ ...form, assertionType: val as AssertionType });
                        }}
                      >
                        <SelectTrigger id="assertionType" className="w-[190px] shrink-0">
                          <SelectValue>
                            {(val: AssertionType) => ASSERTION_LABELS[val] ?? ASSERTION_LABELS.Contains}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(ASSERTION_LABELS) as AssertionType[]).map((type) => (
                            <SelectItem key={type} value={type}>
                              {ASSERTION_LABELS[type]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Switch
                          id="keywordInverted"
                          checked={form.keywordInverted}
                          onCheckedChange={(checked) => setForm({ ...form, keywordInverted: checked })}
                        />
                        <Label htmlFor="keywordInverted" className="text-xs font-normal">
                          Invert
                        </Label>
                      </div>
                    </div>

                    {form.assertionType === 'JsonPath' && (
                      <Input
                        id="jsonPath"
                        className="font-mono text-xs"
                        placeholder="$.status"
                        value={form.jsonPath}
                        onChange={(e) => setForm({ ...form, jsonPath: e.target.value })}
                      />
                    )}

                    <Input
                      id="keyword"
                      className={form.assertionType === 'Contains' ? undefined : 'font-mono text-xs'}
                      placeholder={
                        form.assertionType === 'Regex'
                          ? '"status":\\s*"(healthy|ok)"'
                          : form.assertionType === 'JsonPath'
                            ? 'ok'
                            : 'e.g. "healthy"'
                      }
                      value={form.keyword}
                      onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                    />

                    <p className="text-xs text-muted-foreground">
                      {form.assertionType === 'Regex'
                        ? 'The check fails unless the body matches this pattern — or, inverted, when it does. Patterns use RE2, so lookahead, lookbehind and backreferences are not available.'
                        : form.assertionType === 'JsonPath'
                          ? 'The path selects a value from the JSON body, which must equal the text below. Leave the value blank to assert only that the path resolves. Supports $.a.b, $["a"] and $.list[0].'
                          : "The check fails when the body doesn't contain this text — or, inverted, when it does."}{' '}
                      Only the first megabyte of the response is searched.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="requestHeaders">Headers (JSON)</Label>
                    <Textarea
                      id="requestHeaders"
                      rows={2}
                      className="font-mono text-xs"
                      placeholder='{"Authorization": "Bearer …"}'
                      value={form.requestHeaders}
                      onChange={(e) => setForm({ ...form, requestHeaders: e.target.value })}
                    />
                  </div>

                  {form.method !== 'GET' && form.method !== 'HEAD' && (
                    <div className="grid gap-2">
                      <Label htmlFor="requestBody">Request body</Label>
                      <Textarea
                        id="requestBody"
                        rows={2}
                        className="font-mono text-xs"
                        value={form.requestBody}
                        onChange={(e) => setForm({ ...form, requestBody: e.target.value })}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <Label htmlFor="followRedirects" className="text-sm font-normal">
                      Follow redirects
                    </Label>
                    <Switch
                      id="followRedirects"
                      checked={form.followRedirects}
                      onCheckedChange={(checked) => setForm({ ...form, followRedirects: checked })}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3 rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Overrides</Label>
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use the instance defaults from Settings → Monitoring. A slow
                    nightly batch API and a health endpoint are never usefully held to the same
                    latency threshold.
                  </p>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="httpTimeoutSeconds" className="text-xs font-normal">
                      Timeout (s)
                    </Label>
                    <Input
                      id="httpTimeoutSeconds"
                      type="number"
                      min={1}
                      max={300}
                      placeholder="Default"
                      value={form.httpTimeoutSeconds}
                      onChange={(e) => setForm({ ...form, httpTimeoutSeconds: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="latencyThresholdMs" className="text-xs font-normal">
                      Degraded above (ms)
                    </Label>
                    <Input
                      id="latencyThresholdMs"
                      type="number"
                      min={50}
                      max={60000}
                      placeholder="Default"
                      value={form.latencyThresholdMs}
                      onChange={(e) => setForm({ ...form, latencyThresholdMs: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="failedAttemptsThreshold" className="text-xs font-normal">
                      Failures before alert
                    </Label>
                    <Input
                      id="failedAttemptsThreshold"
                      type="number"
                      min={1}
                      max={20}
                      placeholder="Default"
                      value={form.failedAttemptsThreshold}
                      onChange={(e) => setForm({ ...form, failedAttemptsThreshold: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sloTarget">Availability target (SLO)</Label>
                <Input
                  id="sloTarget"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  placeholder="e.g. 99.9 — leave blank for no target"
                  value={form.sloTarget}
                  onChange={(e) => setForm({ ...form, sloTarget: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Used on the Reports page to work out whether the month met its target, and how much
                  of the error budget it spent. It does not affect alerting.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="escalation">Escalation policy</Label>
                <Select
                  value={form.escalationPolicyId}
                  onValueChange={(val) => {
                    if (val) setForm({ ...form, escalationPolicyId: val });
                  }}
                >
                  <SelectTrigger id="escalation">
                    <SelectValue>
                      {(val: string) =>
                        val === NO_ESCALATION_POLICY
                          ? 'No escalation (use broadcast)'
                          : (escalationPolicies.find((p) => p.id === val)?.name ?? 'No escalation (use broadcast)')
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ESCALATION_POLICY}>No escalation (use broadcast)</SelectItem>
                    {escalationPolicies.map((policy) => (
                      <SelectItem key={policy.id} value={policy.id}>
                        {policy.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Leave as-is to notify every enabled integration on an incident (or whatever the
                  notification rules say). Pick a policy to page its steps in order instead.
                </p>
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>

            <SheetFooter>
              <div className="flex gap-2 w-full">
                <Button type="button" variant="outline" className="flex-1" onClick={closeForm}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={isSaving}>
                  {isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Save & Start'}
                </Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Search & Status Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or URL..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Tabs defaultValue="all" value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All ({monitors.length})</TabsTrigger>
            <TabsTrigger value="up">
              Up ({monitors.filter((m) => m.status === 'Up').length})
            </TabsTrigger>
            <TabsTrigger value="down">
              Down ({monitors.filter((m) => m.status === 'Down').length})
            </TabsTrigger>
            <TabsTrigger value="paused">
              Paused ({monitors.filter((m) => !m.enabled).length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Monitors Table */}
      <div className="border rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Monitor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Uptime</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Interval</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMonitors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No monitors found.
                </TableCell>
              </TableRow>
            ) : (
              filteredMonitors.map((monitor) => (
                <TableRow key={monitor.id} className={monitor.enabled ? undefined : 'opacity-60'}>
                  {/* Name + URL */}
                  <TableCell>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{monitor.name}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                          {monitor.type}
                        </Badge>
                      </div>
                      <a
                        href={monitor.type === 'HTTP' ? monitor.url : undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground hover:underline flex items-center gap-1 mt-0.5"
                      >
                        {monitor.url}
                        {monitor.port ? `:${monitor.port}` : ''}
                        {monitor.type === 'HTTP' && <ExternalLink className="h-3 w-3" />}
                      </a>
                      {certExpiryNotice(monitor.certExpiresAt) && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                          <ShieldAlert className="h-3 w-3" />
                          {certExpiryNotice(monitor.certExpiresAt)}
                        </span>
                      )}
                      {domainExpiryNotice(monitor.domainExpiresAt) && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                          <ShieldAlert className="h-3 w-3" />
                          {domainExpiryNotice(monitor.domainExpiresAt)}
                        </span>
                      )}
                      {monitor.flappingSince && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                          <Activity className="h-3 w-3" />
                          Flapping since {new Date(monitor.flappingSince).toLocaleString()} — incidents suppressed
                        </span>
                      )}
                      {monitor.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {monitor.tags.map((tag) => (
                            <Badge key={tag.id} variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </TableCell>

                  {/* Status Badge */}
                  <TableCell>
                    {!monitor.enabled ? (
                      <Badge variant="secondary" className="gap-1.5">
                        <Pause className="h-3.5 w-3.5" />
                        Paused
                      </Badge>
                    ) : (
                    <Badge
                      variant="secondary"
                      className={
                        monitor.status === 'Up'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1.5'
                          : monitor.status === 'Degraded'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20 gap-1.5'
                            : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20 gap-1.5'
                      }
                    >
                      {monitor.status === 'Up' && <CheckCircle2 className="h-3.5 w-3.5" />}
                      {monitor.status === 'Degraded' && <AlertTriangle className="h-3.5 w-3.5" />}
                      {monitor.status === 'Down' && <XCircle className="h-3.5 w-3.5" />}
                      {monitor.status}
                    </Badge>
                    )}
                  </TableCell>

                  {/* Uptime Percentage */}
                  <TableCell className="font-medium text-sm">
                    {monitor.uptime.toFixed(2)}%
                  </TableCell>

                  {/* Latency (Response Time) */}
                  <TableCell>
                    {monitor.status === 'Down' || monitor.responseTime === null ? (
                      <span className="text-xs text-muted-foreground">-</span>
                    ) : (
                      <span
                        className={
                          monitor.responseTime > 500
                            ? 'text-amber-600 font-medium text-sm'
                            : 'text-sm'
                        }
                      >
                        {monitor.responseTime} ms
                      </span>
                    )}
                  </TableCell>

                  {/* Interval & Last checked */}
                  <TableCell>
                    <div className="flex flex-col text-xs text-muted-foreground">
                      <span>{monitor.interval}</span>
                      <span>{formatLastChecked(monitor.lastCheckedAt)}</span>
                    </div>
                  </TableCell>

                  {/* Actions drop down */}
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>Options</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => handleCopyUrl(monitor.url)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy URL
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(monitor)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setMonitorEnabled.mutate({ id: monitor.id, enabled: !monitor.enabled })
                            }
                          >
                            {monitor.enabled ? (
                              <>
                                <Pause className="mr-2 h-4 w-4" />
                                Pause checks
                              </>
                            ) : (
                              <>
                                <Play className="mr-2 h-4 w-4" />
                                Resume checks
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteMonitor(monitor.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
