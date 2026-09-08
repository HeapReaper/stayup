'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, MoreHorizontal, Pencil, Trash2, ChevronsUp, X } from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { EscalationPolicySummary } from '@/trpc/routers/escalationPolicy';
import type { IntegrationSummary } from '@/trpc/routers/integration';
import type { OnCallScheduleSummary } from '@/trpc/routers/oncall';
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

interface EscalationsClientPageProps {
  initialPolicies: EscalationPolicySummary[];
  initialIntegrations: IntegrationSummary[];
  initialSchedules: OnCallScheduleSummary[];
}

// `key` is a client-only id (not sent to the server) so React has something
// stable to key each step row on — the array index would shift every add/
// remove, breaking focus/input state.
// A step targets an integration or an on-call schedule. The form keeps that
// as one prefixed string ("integration:abc" / "oncall:abc") so it can be a
// single <Select>, and splits it again on submit — picking a target is one
// decision, not two.
type StepFormState = { key: string; delayMinutes: string; target: string };

const INTEGRATION_PREFIX = 'integration:';
const ONCALL_PREFIX = 'oncall:';

function targetValue(integrationId: string | null, onCallScheduleId: string | null): string {
  if (onCallScheduleId) return ONCALL_PREFIX + onCallScheduleId;
  if (integrationId) return INTEGRATION_PREFIX + integrationId;
  return '';
}

function splitTarget(target: string): { integrationId: string | null; onCallScheduleId: string | null } {
  if (target.startsWith(ONCALL_PREFIX)) {
    return { integrationId: null, onCallScheduleId: target.slice(ONCALL_PREFIX.length) };
  }
  if (target.startsWith(INTEGRATION_PREFIX)) {
    return { integrationId: target.slice(INTEGRATION_PREFIX.length), onCallScheduleId: null };
  }
  return { integrationId: null, onCallScheduleId: null };
}
type FormState = { name: string; steps: StepFormState[] };

/** What the collapsed <Select> shows for a step's chosen target. */
function targetLabel(
  target: string,
  integrations: IntegrationSummary[],
  schedules: OnCallScheduleSummary[],
): string {
  const { integrationId, onCallScheduleId } = splitTarget(target);
  if (onCallScheduleId) {
    const schedule = schedules.find((s) => s.id === onCallScheduleId);
    return schedule ? `On call: ${schedule.name}` : 'On call (deleted schedule)';
  }
  if (integrationId) {
    return integrations.find((i) => i.id === integrationId)?.name ?? 'Deleted integration';
  }
  return 'Pick who this step pages';
}

function newStep(delayMinutes: string): StepFormState {
  return { key: crypto.randomUUID(), delayMinutes, target: '' };
}

function emptyForm(): FormState {
  return { name: '', steps: [newStep('0')] };
}

export default function EscalationsClientPage({
  initialPolicies,
  initialIntegrations,
  initialSchedules,
}: EscalationsClientPageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const policiesQuery = useQuery({
    ...trpc.escalationPolicy.getAll.queryOptions(),
    initialData: initialPolicies,
  });
  const policies = policiesQuery.data;

  const integrationsQuery = useQuery({
    ...trpc.integration.getAll.queryOptions(),
    initialData: initialIntegrations,
  });
  const integrations = integrationsQuery.data;

  const schedulesQuery = useQuery({
    ...trpc.onCall.getAll.queryOptions(),
    initialData: initialSchedules,
  });
  const schedules = schedulesQuery.data;

  const [searchQuery, setSearchQuery] = React.useState('');
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm());
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = React.useState(false);

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: trpc.escalationPolicy.getAll.queryKey() });

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const createPolicy = useMutation(
    trpc.escalationPolicy.create.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const updatePolicy = useMutation(
    trpc.escalationPolicy.update.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const deletePolicy = useMutation(
    trpc.escalationPolicy.delete.mutationOptions({ onSuccess: () => invalidateAll() }),
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = async (policy: EscalationPolicySummary) => {
    setEditingId(policy.id);
    setFormError(null);
    setIsFormOpen(true);
    setIsLoadingDetail(true);
    try {
      const detail = await queryClient.fetchQuery(trpc.escalationPolicy.getById.queryOptions({ id: policy.id }));
      setForm({
        name: detail.name,
        steps: detail.steps.length
          ? detail.steps.map((step) => ({
              key: crypto.randomUUID(),
              delayMinutes: String(step.delayMinutes),
              target: targetValue(step.integrationId, step.onCallScheduleId),
            }))
          : [newStep('0')],
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to load policy');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const addStep = () => {
    setForm((prev) => ({ ...prev, steps: [...prev.steps, newStep('5')] }));
  };

  const removeStep = (index: number) => {
    setForm((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
  };

  const updateStep = (index: number, patch: Partial<StepFormState>) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (form.steps.some((step) => !step.target)) {
      setFormError('Every step needs an integration selected.');
      return;
    }

    const payload = {
      name: form.name,
      steps: form.steps.map((step) => ({
        delayMinutes: Number(step.delayMinutes) || 0,
        ...splitTarget(step.target),
      })),
    };

    if (editingId) {
      updatePolicy.mutate({ id: editingId, ...payload });
    } else {
      createPolicy.mutate(payload);
    }
  };

  const filteredPolicies = policies.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const isSaving = createPolicy.isPending || updatePolicy.isPending;

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Escalation Policies</h1>
          <p className="text-sm text-muted-foreground">
            If nobody acknowledges an incident in time, page the next integration in line. Attach a
            policy to a monitor from the Monitors page — that monitor's incidents are then paged
            through these steps instead of the usual broadcast to every enabled integration.
          </p>
        </div>

        <Button className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Policy
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
            <SheetTitle>{editingId ? 'Edit Escalation Policy' : 'New Escalation Policy'}</SheetTitle>
            <SheetDescription>
              Order matters — step 1 pages first, and each later step fires only if the incident is
              still unacknowledged after its delay.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="ep-name">Name</Label>
                <Input
                  id="ep-name"
                  placeholder="Ex. Primary on-call"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label>Steps</Label>
                <div className="space-y-2">
                  {form.steps.map((step, index) => (
                    <div key={step.key} className="flex items-start gap-2 rounded-lg border p-2">
                      <div className="flex h-9 w-6 shrink-0 items-center justify-center text-xs font-medium text-muted-foreground">
                        {index + 1}
                      </div>
                      <div className="flex-1 grid gap-2">
                        <Select
                          value={step.target}
                          onValueChange={(val) => {
                            if (val) updateStep(index, { target: val });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue>{() => targetLabel(step.target, integrations, schedules)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {schedules.map((schedule) => (
                              <SelectItem key={schedule.id} value={ONCALL_PREFIX + schedule.id}>
                                On call: {schedule.name}
                                {schedule.currentName ? ` (now ${schedule.currentName})` : ''}
                              </SelectItem>
                            ))}
                            {integrations.map((integration) => (
                              <SelectItem key={integration.id} value={INTEGRATION_PREFIX + integration.id}>
                                {integration.name} ({integration.type})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">
                            {index === 0 ? 'Wait' : 'Then wait'}
                          </span>
                          <Input
                            type="number"
                            min={0}
                            max={1440}
                            className="h-8"
                            value={step.delayMinutes}
                            onChange={(e) => updateStep(index, { delayMinutes: e.target.value })}
                          />
                          <span className="text-xs text-muted-foreground shrink-0">min, then page</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={() => removeStep(index)}
                        disabled={form.steps.length === 1}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-1.5 self-start" onClick={addStep}>
                  <Plus className="h-3.5 w-3.5" />
                  Add step
                </Button>
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>

            <SheetFooter>
              <div className="flex gap-2 w-full">
                <Button type="button" variant="outline" className="flex-1" onClick={closeForm}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={isSaving || isLoadingDetail}>
                  {isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Policy'}
                </Button>
              </div>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Search Bar */}
      <div className="relative w-full sm:w-80">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name..."
          className="pl-8"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Policies Table */}
      <div className="border rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Policy</TableHead>
              <TableHead>Steps</TableHead>
              <TableHead>Monitors</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPolicies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No escalation policies yet.
                </TableCell>
              </TableRow>
            ) : (
              filteredPolicies.map((policy) => (
                <TableRow key={policy.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ChevronsUp className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-semibold text-sm">{policy.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal">
                      {policy.stepCount} step{policy.stepCount === 1 ? '' : 's'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {policy.monitorCount} monitor{policy.monitorCount === 1 ? '' : 's'}
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
                          <DropdownMenuItem onClick={() => openEdit(policy)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => deletePolicy.mutate({ id: policy.id })}
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
