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
} from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { Monitor, MonitorType, MonitorInterval } from '@/trpc/routers/monitor';
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
};

const MONITOR_INTERVAL_LABELS: Record<MonitorInterval, string> = {
  '15s': 'Every 15 sec',
  '30s': 'Every 30 sec',
  '60s': 'Every minute',
  '5m': 'Every 5 min',
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
  };
}

function formatLastChecked(date: Date | string | null) {
  if (!date) return 'Never checked';
  return new Date(date).toLocaleString();
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

  // Filter by search query & status tab
  const filteredMonitors = monitors.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.url.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' || m.status.toLowerCase() === statusFilter.toLowerCase();

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
      port: form.type === 'Port' ? Number(form.port) : undefined,
      tagNames: form.tags,
      escalationPolicyId: form.escalationPolicyId === NO_ESCALATION_POLICY ? null : form.escalationPolicyId,
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
                <Label htmlFor="url">URL, host or IP address</Label>
                <Input
                  id="url"
                  placeholder="https://api.example.com/health"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  required
                />
              </div>

              {form.type === 'Port' && (
                <div className="grid gap-2">
                  <Label htmlFor="port">Port</Label>
                  <Input
                    id="port"
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="80"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    required
                  />
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
                      <SelectItem value="HTTP">HTTP(s)</SelectItem>
                      <SelectItem value="Ping">Ping</SelectItem>
                      <SelectItem value="Port">Port</SelectItem>
                      <SelectItem value="DNS">DNS</SelectItem>
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
                  Leave as-is to notify every enabled integration on an incident. Pick a policy to
                  page its steps in order instead.
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
                <TableRow key={monitor.id}>
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
