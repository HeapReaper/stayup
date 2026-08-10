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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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

type MonitorFormState = {
  name: string;
  url: string;
  type: MonitorType;
  interval: MonitorInterval;
  port: string;
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

const emptyForm: MonitorFormState = {
  name: '',
  url: '',
  type: 'HTTP',
  interval: '60s',
  port: '',
};

function monitorToForm(monitor: Monitor): MonitorFormState {
  return {
    name: monitor.name,
    url: monitor.url,
    type: monitor.type,
    interval: monitor.interval,
    port: monitor.port ? String(monitor.port) : '',
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

  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');

  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [addForm, setAddForm] = React.useState<MonitorFormState>(emptyForm);
  const [addError, setAddError] = React.useState<string | null>(null);

  const [editingMonitor, setEditingMonitor] = React.useState<Monitor | null>(null);
  const [editForm, setEditForm] = React.useState<MonitorFormState>(emptyForm);
  const [editError, setEditError] = React.useState<string | null>(null);

  const invalidateMonitors = () =>
    queryClient.invalidateQueries({ queryKey: trpc.monitor.getAll.queryKey() });

  const createMonitor = useMutation(
    trpc.monitor.create.mutationOptions({
      onSuccess: () => {
        invalidateMonitors();
        setAddForm(emptyForm);
        setAddError(null);
        setIsAddOpen(false);
      },
      onError: (error) => setAddError(error.message),
    }),
  );

  const updateMonitor = useMutation(
    trpc.monitor.update.mutationOptions({
      onSuccess: () => {
        invalidateMonitors();
        setEditError(null);
        setEditingMonitor(null);
      },
      onError: (error) => setEditError(error.message),
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

  const handleAddMonitor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name || !addForm.url) return;

    createMonitor.mutate({
      name: addForm.name,
      url: addForm.url,
      type: addForm.type,
      interval: addForm.interval,
      port: addForm.type === 'Port' ? Number(addForm.port) : undefined,
    });
  };

  const openEditDialog = (monitor: Monitor) => {
    setEditingMonitor(monitor);
    setEditForm(monitorToForm(monitor));
    setEditError(null);
  };

  const handleEditMonitor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMonitor || !editForm.name || !editForm.url) return;

    updateMonitor.mutate({
      id: editingMonitor.id,
      name: editForm.name,
      url: editForm.url,
      type: editForm.type,
      interval: editForm.interval,
      port: editForm.type === 'Port' ? Number(editForm.port) : undefined,
    });
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

        {/* Modal for new monitor */}
        <Dialog open={isAddOpen} onOpenChange={(open) => {
          setIsAddOpen(open);
          if (!open) {
            setAddForm(emptyForm);
            setAddError(null);
          }
        }}>
          <DialogTrigger
            render={
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Monitor
              </Button>
            }
          />
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={handleAddMonitor}>
              <DialogHeader>
                <DialogTitle>Add new monitor</DialogTitle>
                <DialogDescription>
                  Configure a new endpoint to continuously test availability and performance.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="Ex. Production API"
                    value={addForm.name}
                    onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="url">URL, host or IP address</Label>
                  <Input
                    id="url"
                    placeholder="https://api.example.com/health"
                    value={addForm.url}
                    onChange={(e) => setAddForm({ ...addForm, url: e.target.value })}
                    required
                  />
                </div>

                {addForm.type === 'Port' && (
                  <div className="grid gap-2">
                    <Label htmlFor="port">Port</Label>
                    <Input
                      id="port"
                      type="number"
                      min={1}
                      max={65535}
                      placeholder="80"
                      value={addForm.port}
                      onChange={(e) => setAddForm({ ...addForm, port: e.target.value })}
                      required
                    />
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="type">Type</Label>
                    <Select
                      value={addForm.type}
                      onValueChange={(val) => {
                        if (val) setAddForm({ ...addForm, type: val as MonitorType });
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
                      value={addForm.interval}
                      onValueChange={(val) => {
                        if (val) setAddForm({ ...addForm, interval: val as MonitorInterval });
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

                {addError && <p className="text-sm text-destructive">{addError}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMonitor.isPending}>
                  {createMonitor.isPending ? 'Saving…' : 'Save & Start'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit monitor modal */}
      <Dialog
        open={editingMonitor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingMonitor(null);
            setEditError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleEditMonitor}>
            <DialogHeader>
              <DialogTitle>Edit monitor</DialogTitle>
              <DialogDescription>
                Update the configuration for this endpoint.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  placeholder="Ex. Production API"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-url">URL, host or IP address</Label>
                <Input
                  id="edit-url"
                  placeholder="https://api.example.com/health"
                  value={editForm.url}
                  onChange={(e) => setEditForm({ ...editForm, url: e.target.value })}
                  required
                />
              </div>

              {editForm.type === 'Port' && (
                <div className="grid gap-2">
                  <Label htmlFor="edit-port">Port</Label>
                  <Input
                    id="edit-port"
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="80"
                    value={editForm.port}
                    onChange={(e) => setEditForm({ ...editForm, port: e.target.value })}
                    required
                  />
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-type">Type</Label>
                  <Select
                    value={editForm.type}
                    onValueChange={(val) => {
                      if (val) setEditForm({ ...editForm, type: val as MonitorType });
                    }}
                  >
                    <SelectTrigger id="edit-type">
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
                  <Label htmlFor="edit-interval">Interval</Label>
                  <Select
                    value={editForm.interval}
                    onValueChange={(val) => {
                      if (val) setEditForm({ ...editForm, interval: val as MonitorInterval });
                    }}
                  >
                    <SelectTrigger id="edit-interval">
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

              {editError && <p className="text-sm text-destructive">{editError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingMonitor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMonitor.isPending}>
                {updateMonitor.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
                          <DropdownMenuItem onClick={() => openEditDialog(monitor)}>
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
