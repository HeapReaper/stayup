'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Wrench,
  Ban,
  Clock,
  CheckCircle2,
} from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { MaintenanceWindowSummary, MaintenanceStatus } from '@/trpc/routers/maintenance';
import type { Monitor } from '@/trpc/routers/monitor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface MaintenanceClientPageProps {
  initialWindows: MaintenanceWindowSummary[];
  monitors: Monitor[];
}

type FormState = {
  title: string;
  message: string;
  startsAt: string; // datetime-local value
  endsAt: string;
  monitorIds: string[];
  // Whether subscribers are told about this window at all.
  notifySubscribers: boolean;
};

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 15) + 15, 0, 0);
  return toLocalInputValue(d);
}

function defaultEnd(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 15) + 15, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInputValue(d);
}

function emptyForm(): FormState {
  return {
    title: '',
    message: '',
    startsAt: defaultStart(),
    endsAt: defaultEnd(),
    monitorIds: [],
    notifySubscribers: true,
  };
}

function windowToForm(window: MaintenanceWindowSummary): FormState {
  return {
    title: window.title,
    message: window.message ?? '',
    startsAt: toLocalInputValue(new Date(window.startsAt)),
    endsAt: toLocalInputValue(new Date(window.endsAt)),
    monitorIds: window.monitors.map((m) => m.id),
    notifySubscribers: window.notifySubscribers,
  };
}

function formatDateTime(date: string) {
  return new Date(date).toLocaleString();
}

function StatusBadge({ status }: { status: MaintenanceStatus }) {
  if (status === 'Active') {
    return (
      <Badge
        variant="secondary"
        className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20 gap-1.5 animate-pulse"
      >
        <Wrench className="h-3.5 w-3.5" />
        Active
      </Badge>
    );
  }
  if (status === 'Scheduled') {
    return (
      <Badge variant="secondary" className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20 gap-1.5">
        <Clock className="h-3.5 w-3.5" />
        Scheduled
      </Badge>
    );
  }
  if (status === 'Cancelled') {
    return (
      <Badge variant="secondary" className="bg-muted text-muted-foreground gap-1.5">
        <Ban className="h-3.5 w-3.5" />
        Cancelled
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1.5"
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      Completed
    </Badge>
  );
}

export default function MaintenanceClientPage({ initialWindows, monitors }: MaintenanceClientPageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const windowsQuery = useQuery({
    ...trpc.maintenance.getAll.queryOptions(),
    initialData: initialWindows,
  });
  const windows = windowsQuery.data;

  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm());
  const [formError, setFormError] = React.useState<string | null>(null);

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: trpc.maintenance.getAll.queryKey() });

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const createWindow = useMutation(
    trpc.maintenance.create.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const updateWindow = useMutation(
    trpc.maintenance.update.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const cancelWindow = useMutation(trpc.maintenance.cancel.mutationOptions({ onSuccess: () => invalidateAll() }));
  const deleteWindow = useMutation(trpc.maintenance.delete.mutationOptions({ onSuccess: () => invalidateAll() }));

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (window: MaintenanceWindowSummary) => {
    setEditingId(window.id);
    setForm(windowToForm(window));
    setFormError(null);
    setIsFormOpen(true);
  };

  const toggleMonitor = (monitorId: string) =>
    setForm((prev) => ({
      ...prev,
      monitorIds: prev.monitorIds.includes(monitorId)
        ? prev.monitorIds.filter((id) => id !== monitorId)
        : [...prev.monitorIds, monitorId],
    }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.startsAt || !form.endsAt || form.monitorIds.length === 0) return;

    const payload = {
      title: form.title,
      message: form.message || undefined,
      startsAt: new Date(form.startsAt),
      endsAt: new Date(form.endsAt),
      monitorIds: form.monitorIds,
      notifySubscribers: form.notifySubscribers,
    };

    if (editingId) {
      updateWindow.mutate({ id: editingId, ...payload });
    } else {
      createWindow.mutate(payload);
    }
  };

  const filteredWindows = windows.filter((window) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      window.title.toLowerCase().includes(q) ||
      window.monitors.some((m) => m.name.toLowerCase().includes(q));

    const matchesStatus = statusFilter === 'all' || window.status.toLowerCase() === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const isSaving = createWindow.isPending || updateWindow.isPending;

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Maintenance Windows</h1>
          <p className="text-sm text-muted-foreground">
            Schedule planned maintenance so it doesn't trigger incidents or alerts.
          </p>
        </div>

        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Schedule Maintenance
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
            <SheetTitle>{editingId ? 'Edit Maintenance Window' : 'Schedule Maintenance'}</SheetTitle>
            <SheetDescription>
              Checks still run and are recorded as normal, but a Down/Degraded result won't open an
              incident or send alerts while the window is active.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="mw-title">Title</Label>
                <Input
                  id="mw-title"
                  placeholder="e.g. Database upgrade"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mw-message">Message shown on status page (optional)</Label>
                <Textarea
                  id="mw-message"
                  placeholder="What's happening and what to expect..."
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="mw-start">Starts</Label>
                  <Input
                    id="mw-start"
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="mw-end">Ends</Label>
                  <Input
                    id="mw-end"
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Affected Monitors</Label>
                {monitors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No monitors yet — create one on the Monitors page first.
                  </p>
                ) : (
                  <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                    {monitors.map((monitor) => (
                      <label
                        key={monitor.id}
                        htmlFor={`mw-monitor-${monitor.id}`}
                        className="flex items-center gap-2.5 p-2.5 cursor-pointer"
                      >
                        <Checkbox
                          id={`mw-monitor-${monitor.id}`}
                          checked={form.monitorIds.includes(monitor.id)}
                          onCheckedChange={() => toggleMonitor(monitor.id)}
                        />
                        <span className="text-sm font-medium truncate">{monitor.name}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 ml-auto">
                          {monitor.type}
                        </Badge>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="mw-notify" className="text-sm font-normal">
                    Announce to subscribers
                  </Label>
                  <Switch
                    id="mw-notify"
                    checked={form.notifySubscribers}
                    onCheckedChange={(checked) => setForm({ ...form, notifySubscribers: checked })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Sends three notices — when the window is scheduled, when it starts and when it
                  finishes — to every enabled integration and to everyone subscribed to a status
                  page carrying these monitors. Moving the window re-announces it; cancelling it
                  says so. Turn this off for work nobody outside the team needs to know about.
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
                  {isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Schedule'}
                </Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Search Bar & Status Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by title or monitor..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Tabs defaultValue="all" value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All ({windows.length})</TabsTrigger>
            <TabsTrigger value="active">
              Active ({windows.filter((w) => w.status === 'Active').length})
            </TabsTrigger>
            <TabsTrigger value="scheduled">
              Scheduled ({windows.filter((w) => w.status === 'Scheduled').length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Maintenance Windows Table */}
      <div className="border rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Maintenance & Monitors</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Starts</TableHead>
              <TableHead>Ends</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredWindows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No maintenance windows found.
                </TableCell>
              </TableRow>
            ) : (
              filteredWindows.map((window) => (
                <TableRow key={window.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">{window.title}</span>
                      <span className="text-xs text-muted-foreground mt-0.5">
                        {window.monitors.map((m) => m.name).join(', ') || 'No monitors'}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <StatusBadge status={window.status} />
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(window.startsAt)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(window.endsAt)}
                  </TableCell>

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
                          <DropdownMenuItem onClick={() => openEdit(window)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          {(window.status === 'Scheduled' || window.status === 'Active') && (
                            <DropdownMenuItem onClick={() => cancelWindow.mutate({ id: window.id })}>
                              <Ban className="mr-2 h-4 w-4" />
                              Cancel
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => deleteWindow.mutate({ id: window.id })}
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
