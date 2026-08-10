'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  MoreHorizontal,
  Trash2,
  Siren,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Flame,
  UserCheck,
  Bot,
  MessageSquare,
} from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { IncidentSummary, IncidentImpact, IncidentStatus } from '@/trpc/routers/incident';
import type { Monitor } from '@/trpc/routers/monitor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
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

interface IncidentsClientPageProps {
  initialIncidents: IncidentSummary[];
  monitors: Monitor[];
}

const NO_MONITOR = 'none';

type AddIncidentForm = {
  title: string;
  monitorId: string;
  impact: IncidentImpact;
  message: string;
};

const emptyAddForm: AddIncidentForm = {
  title: '',
  monitorId: NO_MONITOR,
  impact: 'Major',
  message: '',
};

function formatDateTime(date: string) {
  return new Date(date).toLocaleString();
}

function formatDuration(createdAt: string, resolvedAt: string | null) {
  const start = new Date(createdAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((end - start) / 60_000));

  if (minutes < 1) return 'Just started';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

function ImpactBadge({ impact }: { impact: IncidentImpact }) {
  return (
    <Badge
      variant="outline"
      className={
        impact === 'Critical'
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 gap-1'
          : impact === 'Major'
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1'
            : 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 gap-1'
      }
    >
      {impact === 'Critical' && <Flame className="h-3 w-3" />}
      {impact === 'Major' && <AlertTriangle className="h-3 w-3" />}
      {impact}
    </Badge>
  );
}

function StatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <Badge
      variant="secondary"
      className={
        status === 'Resolved'
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1.5'
          : status === 'Investigating'
            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20 gap-1.5 animate-pulse'
            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20 gap-1.5'
      }
    >
      {status === 'Resolved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
      {status}
    </Badge>
  );
}

export default function IncidentsClientPage({ initialIncidents, monitors }: IncidentsClientPageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const incidentsQuery = useQuery({
    ...trpc.incident.getAll.queryOptions(),
    initialData: initialIncidents,
  });
  const incidents = incidentsQuery.data;

  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');

  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [addForm, setAddForm] = React.useState<AddIncidentForm>(emptyAddForm);
  const [addError, setAddError] = React.useState<string | null>(null);

  const [selectedIncidentId, setSelectedIncidentId] = React.useState<string | null>(null);
  const [updateForm, setUpdateForm] = React.useState<{ status: IncidentStatus; message: string }>({
    status: 'Identified',
    message: '',
  });
  const [updateError, setUpdateError] = React.useState<string | null>(null);

  const detailQuery = useQuery({
    ...trpc.incident.getById.queryOptions({ id: selectedIncidentId ?? '' }),
    enabled: selectedIncidentId !== null,
  });

  const invalidateAll = (incidentId?: string) => {
    queryClient.invalidateQueries({ queryKey: trpc.incident.getAll.queryKey() });
    if (incidentId) {
      queryClient.invalidateQueries({ queryKey: trpc.incident.getById.queryKey({ id: incidentId }) });
    }
  };

  const createIncident = useMutation(
    trpc.incident.create.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        setAddForm(emptyAddForm);
        setAddError(null);
        setIsAddOpen(false);
      },
      onError: (error) => setAddError(error.message),
    }),
  );

  const addUpdate = useMutation(
    trpc.incident.addUpdate.mutationOptions({
      onSuccess: () => {
        invalidateAll(selectedIncidentId ?? undefined);
        setUpdateForm({ status: 'Identified', message: '' });
        setUpdateError(null);
      },
      onError: (error) => setUpdateError(error.message),
    }),
  );

  const resolveIncident = useMutation(
    trpc.incident.resolve.mutationOptions({
      onSuccess: (_, variables) => invalidateAll(variables.incidentId),
    }),
  );

  const deleteIncident = useMutation(
    trpc.incident.delete.mutationOptions({
      onSuccess: (_, variables) => {
        invalidateAll();
        if (selectedIncidentId === variables.id) setSelectedIncidentId(null);
      },
    }),
  );

  // Filter by search query & status tab
  const filteredIncidents = incidents.filter((incident) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      incident.title.toLowerCase().includes(q) ||
      (incident.monitor?.name.toLowerCase().includes(q) ?? false) ||
      (incident.createdBy?.name.toLowerCase().includes(q) ?? false);

    const isOngoing = incident.status !== 'Resolved';
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'ongoing' && isOngoing) ||
      (statusFilter === 'resolved' && incident.status === 'Resolved');

    return matchesSearch && matchesStatus;
  });

  const handleAddIncident = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.title || !addForm.message) return;

    createIncident.mutate({
      title: addForm.title,
      monitorId: addForm.monitorId === NO_MONITOR ? undefined : addForm.monitorId,
      impact: addForm.impact,
      message: addForm.message,
    });
  };

  const openIncident = (incident: IncidentSummary) => {
    setSelectedIncidentId(incident.id);
    setUpdateForm({
      status: incident.status === 'Investigating' ? 'Identified' : incident.status,
      message: '',
    });
    setUpdateError(null);
  };

  const handlePostUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncidentId || !updateForm.message) return;

    addUpdate.mutate({
      incidentId: selectedIncidentId,
      status: updateForm.status,
      message: updateForm.message,
    });
  };

  const handleQuickResolve = (id: string) => {
    resolveIncident.mutate({ incidentId: id });
  };

  const handleDeleteIncident = (id: string) => {
    deleteIncident.mutate({ id });
  };

  const detail = detailQuery.data;

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Incidents</h1>
          <p className="text-sm text-muted-foreground">
            Manage active outages, root-cause analyses, and post-mortems.
          </p>
        </div>

        {/* Modal for new incident */}
        <Dialog
          open={isAddOpen}
          onOpenChange={(open) => {
            setIsAddOpen(open);
            if (!open) {
              setAddForm(emptyAddForm);
              setAddError(null);
            }
          }}
        >
          <DialogTrigger
            render={
              <Button variant="destructive" className="gap-2">
                <Siren className="h-4 w-4" />
                Report Incident
              </Button>
            }
          />
          <DialogContent className="sm:max-w-[485px]">
            <form onSubmit={handleAddIncident}>
              <DialogHeader>
                <DialogTitle>Report New Incident</DialogTitle>
                <DialogDescription>
                  Manually create an incident for an outage or performance degradation.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="title">Incident Title</Label>
                  <Input
                    id="title"
                    placeholder="e.g. Database Connection Timeout"
                    value={addForm.title}
                    onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="monitor">Affected Monitor</Label>
                  <Select
                    value={addForm.monitorId}
                    onValueChange={(val) => {
                      if (val) setAddForm({ ...addForm, monitorId: val });
                    }}
                  >
                    <SelectTrigger id="monitor">
                      <SelectValue>
                        {(val: string) =>
                          val === NO_MONITOR
                            ? 'No specific monitor'
                            : monitors.find((m) => m.id === val)?.name ?? val
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_MONITOR}>No specific monitor</SelectItem>
                      {monitors.map((monitor) => (
                        <SelectItem key={monitor.id} value={monitor.id}>
                          {monitor.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="impact">Impact Level</Label>
                  <Select
                    value={addForm.impact}
                    onValueChange={(val) => {
                      if (val) setAddForm({ ...addForm, impact: val as IncidentImpact });
                    }}
                  >
                    <SelectTrigger id="impact">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Critical">Critical</SelectItem>
                      <SelectItem value="Major">Major</SelectItem>
                      <SelectItem value="Minor">Minor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Initial Status Update</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe the current situation and what is being investigated..."
                    value={addForm.message}
                    onChange={(e) => setAddForm({ ...addForm, message: e.target.value })}
                    rows={3}
                    required
                  />
                </div>

                {addError && <p className="text-sm text-destructive">{addError}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={createIncident.isPending}>
                  {createIncident.isPending ? 'Creating…' : 'Create Incident'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Incident detail panel: timeline + post update */}
      <Sheet
        open={selectedIncidentId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedIncidentId(null);
            setUpdateError(null);
          }
        }}
      >
        <SheetContent side="right" className="sm:max-w-lg w-full">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle>{detail.title}</SheetTitle>
                <SheetDescription>
                  {detail.monitor ? `Monitor: ${detail.monitor.name}` : 'No monitor linked'}
                </SheetDescription>
                <div className="flex items-center gap-2 pt-1">
                  <ImpactBadge impact={detail.impact} />
                  <StatusBadge status={detail.status} />
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-4 space-y-4">
                {detail.updates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No updates yet.</p>
                ) : (
                  <ol className="space-y-4 border-l pl-4">
                    {detail.updates.map((update) => (
                      <li key={update.id} className="relative">
                        <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                        <div className="flex items-center gap-2">
                          <StatusBadge status={update.status} />
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(update.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm mt-1 whitespace-pre-line">{update.message}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          {update.author ? (
                            <>
                              <UserCheck className="h-3 w-3" /> {update.author.name}
                            </>
                          ) : (
                            <>
                              <Bot className="h-3 w-3" /> Automated
                            </>
                          )}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <SheetFooter>
                <form onSubmit={handlePostUpdate} className="w-full space-y-3">
                  <div className="grid gap-2">
                    <Label htmlFor="update-status">New Status</Label>
                    <Select
                      value={updateForm.status}
                      onValueChange={(val) => {
                        if (val) setUpdateForm({ ...updateForm, status: val as IncidentStatus });
                      }}
                    >
                      <SelectTrigger id="update-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Investigating">Investigating</SelectItem>
                        <SelectItem value="Identified">Identified</SelectItem>
                        <SelectItem value="Monitoring">Monitoring</SelectItem>
                        <SelectItem value="Resolved">Resolved</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="update-message">Update</Label>
                    <Textarea
                      id="update-message"
                      placeholder="e.g. We've identified the issue and are applying a fix..."
                      value={updateForm.message}
                      onChange={(e) => setUpdateForm({ ...updateForm, message: e.target.value })}
                      rows={3}
                      required
                    />
                  </div>
                  {updateError && <p className="text-sm text-destructive">{updateError}</p>}
                  <Button type="submit" className="w-full gap-2" disabled={addUpdate.isPending}>
                    <MessageSquare className="h-4 w-4" />
                    {addUpdate.isPending ? 'Posting…' : 'Post Update'}
                  </Button>
                </form>
              </SheetFooter>
            </>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          )}
        </SheetContent>
      </Sheet>

      {/* Search Bar & Status Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title, monitor, or reporter..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Tabs defaultValue="all" value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All ({incidents.length})</TabsTrigger>
            <TabsTrigger value="ongoing">
              Ongoing ({incidents.filter((i) => i.status !== 'Resolved').length})
            </TabsTrigger>
            <TabsTrigger value="resolved">
              Resolved ({incidents.filter((i) => i.status === 'Resolved').length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Incidents Table */}
      <div className="border rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Incident & Monitor</TableHead>
              <TableHead>Impact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reported</TableHead>
              <TableHead>Duration / Started</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredIncidents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No incidents found.
                </TableCell>
              </TableRow>
            ) : (
              filteredIncidents.map((incident) => (
                <TableRow
                  key={incident.id}
                  className="cursor-pointer"
                  onClick={() => openIncident(incident)}
                >
                  {/* Title & Monitor */}
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">{incident.title}</span>
                      <span className="text-xs text-muted-foreground mt-0.5">
                        {incident.monitor ? `Monitor: ${incident.monitor.name}` : 'No monitor linked'}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <ImpactBadge impact={incident.impact} />
                  </TableCell>

                  <TableCell>
                    <StatusBadge status={incident.status} />
                  </TableCell>

                  {/* Reported by */}
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      {incident.createdBy ? (
                        <>
                          <UserCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span>{incident.createdBy.name}</span>
                        </>
                      ) : (
                        <>
                          <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground">Auto-detected</span>
                        </>
                      )}
                    </div>
                  </TableCell>

                  {/* Duration / Started at */}
                  <TableCell>
                    <div className="flex flex-col text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {formatDuration(incident.createdAt, incident.resolvedAt)}
                      </span>
                      <span>{formatDateTime(incident.createdAt)}</span>
                    </div>
                  </TableCell>

                  {/* Actions Dropdown Menu */}
                  <TableCell onClick={(e) => e.stopPropagation()}>
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
                          {incident.status !== 'Resolved' && (
                            <DropdownMenuItem onClick={() => handleQuickResolve(incident.id)}>
                              <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                              Mark as Resolved
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => openIncident(incident)}>
                            <MessageSquare className="mr-2 h-4 w-4" />
                            View & Add Update
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteIncident(incident.id)}
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
