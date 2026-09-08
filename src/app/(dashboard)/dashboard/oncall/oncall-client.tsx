'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, CalendarClock, UserRound } from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { OnCallScheduleSummary, OnCallScheduleDetail } from '@/trpc/routers/oncall';
import type { IntegrationSummary } from '@/trpc/routers/integration';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface OnCallClientPageProps {
  initialSchedules: OnCallScheduleSummary[];
  integrations: IntegrationSummary[];
  canWrite: boolean;
}

type ParticipantFormState = { key: string; name: string; integrationId: string };
type FormState = {
  name: string;
  timezone: string;
  rotationType: 'Daily' | 'Weekly';
  handoffHour: string;
  handoffDay: string;
  participants: ParticipantFormState[];
};

const WEEKDAYS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '7', label: 'Sunday' },
];

function newParticipant(): ParticipantFormState {
  return { key: crypto.randomUUID(), name: '', integrationId: '' };
}

function emptyForm(): FormState {
  return {
    name: '',
    // Sensible default: whatever zone the browser is in beats a hardcoded UTC
    // that nobody's handoff actually happens in.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    rotationType: 'Weekly',
    handoffHour: '9',
    handoffDay: '1',
    participants: [newParticipant()],
  };
}

function describeRotation(schedule: OnCallScheduleSummary): string {
  const hour = `${String(schedule.handoffHour).padStart(2, '0')}:00`;
  if (schedule.rotationType === 'Daily') return `Daily at ${hour} ${schedule.timezone}`;
  const day = WEEKDAYS.find((d) => d.value === String(schedule.handoffDay))?.label ?? 'Monday';
  return `Weekly, ${day} ${hour} ${schedule.timezone}`;
}

export default function OnCallClientPage({ initialSchedules, integrations, canWrite }: OnCallClientPageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const schedulesQuery = useQuery({ ...trpc.onCall.getAll.queryOptions(), initialData: initialSchedules });
  const schedules = schedulesQuery.data;

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm());
  const [formError, setFormError] = React.useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.onCall.getAll.queryKey() });

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const onSaved = () => {
    invalidate();
    closeForm();
  };
  const onFailed = (error: { message: string }) => setFormError(error.message);

  const createSchedule = useMutation(
    trpc.onCall.create.mutationOptions({ onSuccess: onSaved, onError: onFailed }),
  );
  const updateSchedule = useMutation(
    trpc.onCall.update.mutationOptions({ onSuccess: onSaved, onError: onFailed }),
  );
  const deleteSchedule = useMutation(
    trpc.onCall.delete.mutationOptions({ onSuccess: invalidate, onError: onFailed }),
  );

  const openEdit = async (id: string) => {
    const detail = (await queryClient.fetchQuery(trpc.onCall.getById.queryOptions({ id }))) as OnCallScheduleDetail;
    setEditingId(id);
    setForm({
      name: detail.name,
      timezone: detail.timezone,
      rotationType: detail.rotationType === 'Daily' ? 'Daily' : 'Weekly',
      handoffHour: String(detail.handoffHour),
      handoffDay: String(detail.handoffDay),
      participants: detail.participants.map((p) => ({
        key: p.id,
        name: p.name,
        integrationId: p.integrationId,
      })),
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const updateParticipant = (index: number, patch: Partial<ParticipantFormState>) => {
    setForm((prev) => ({
      ...prev,
      participants: prev.participants.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (form.participants.some((p) => !p.name.trim() || !p.integrationId)) {
      setFormError('Give every person a name and a way to page them');
      return;
    }

    const payload = {
      name: form.name,
      timezone: form.timezone,
      rotationType: form.rotationType,
      handoffHour: Number(form.handoffHour),
      handoffDay: Number(form.handoffDay),
      participants: form.participants.map((p) => ({ name: p.name.trim(), integrationId: p.integrationId })),
    };

    if (editingId) updateSchedule.mutate({ id: editingId, ...payload });
    else createSchedule.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">On-call schedules</h1>
          <p className="text-sm text-muted-foreground">
            A rotation of people taking the pager in turn. Point an escalation step at a schedule and
            that rung pages whoever is up at the moment it fires — not whoever was up when the
            incident opened.
          </p>
        </div>
        <Button className="gap-2" disabled={!canWrite} onClick={() => { setForm(emptyForm()); setEditingId(null); setIsFormOpen(true); }}>
          <Plus className="h-4 w-4" /> New schedule
        </Button>
      </div>

      {formError && !isFormOpen && <p className="text-sm text-destructive">{formError}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Rotations
          </CardTitle>
          <CardDescription>
            Who holds the pager right now is worked out on every lookup, so reordering the roster
            takes effect immediately rather than at the next handoff.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No schedules yet. Without one, escalation steps page a fixed integration.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Rotation</TableHead>
                    <TableHead>On call now</TableHead>
                    <TableHead>Until</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((schedule) => (
                    <TableRow key={schedule.id}>
                      <TableCell>
                        <div className="font-medium">{schedule.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {schedule.participantCount} person{schedule.participantCount === 1 ? '' : 's'}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{describeRotation(schedule)}</TableCell>
                      <TableCell>
                        {schedule.currentName ? (
                          <div className="flex items-center gap-2">
                            <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{schedule.currentName}</span>
                            {schedule.currentOverridden && <Badge variant="secondary">Override</Badge>}
                          </div>
                        ) : (
                          <span className="text-sm text-destructive">
                            Nobody{schedule.currentReason ? ` — ${schedule.currentReason}` : ''}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {schedule.shiftEndsAt ? new Date(schedule.shiftEndsAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" disabled={!canWrite} onClick={() => openEdit(schedule.id)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!canWrite}
                            onClick={() => deleteSchedule.mutate({ id: schedule.id })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={(open) => (open ? setIsFormOpen(true) : closeForm())}>
        <SheetContent className="flex flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editingId ? 'Edit schedule' : 'New schedule'}</SheetTitle>
            <SheetDescription>
              People take the pager in the order listed, one shift each.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="oc-name">Name</Label>
                <Input
                  id="oc-name"
                  placeholder="Ex. Platform on-call"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="oc-tz">Timezone</Label>
                <Input
                  id="oc-tz"
                  placeholder="Europe/Amsterdam"
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  An IANA zone name. The handoff happens on this clock, so it stays at the same local
                  hour across daylight saving.
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="oc-rotation">Rotation</Label>
                  <Select
                    value={form.rotationType}
                    onValueChange={(val) => val && setForm({ ...form, rotationType: val as 'Daily' | 'Weekly' })}
                  >
                    <SelectTrigger id="oc-rotation">
                      <SelectValue>{(val: string) => val}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Weekly">Weekly</SelectItem>
                      <SelectItem value="Daily">Daily</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.rotationType === 'Weekly' && (
                  <div className="grid gap-2">
                    <Label htmlFor="oc-day">Handoff day</Label>
                    <Select value={form.handoffDay} onValueChange={(val) => val && setForm({ ...form, handoffDay: val })}>
                      <SelectTrigger id="oc-day">
                        <SelectValue>
                          {(val: string) => WEEKDAYS.find((d) => d.value === val)?.label ?? 'Monday'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAYS.map((day) => (
                          <SelectItem key={day.value} value={day.value}>
                            {day.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid gap-2">
                  <Label htmlFor="oc-hour">Handoff hour</Label>
                  <Input
                    id="oc-hour"
                    type="number"
                    min={0}
                    max={23}
                    value={form.handoffHour}
                    onChange={(e) => setForm({ ...form, handoffHour: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Roster</Label>
                <div className="space-y-2">
                  {form.participants.map((participant, index) => (
                    <div key={participant.key} className="flex items-start gap-2 rounded-lg border p-2">
                      <div className="flex h-9 w-6 shrink-0 items-center justify-center text-xs font-medium text-muted-foreground">
                        {index + 1}
                      </div>
                      <div className="flex-1 grid gap-2">
                        <Input
                          placeholder="Name"
                          value={participant.name}
                          onChange={(e) => updateParticipant(index, { name: e.target.value })}
                        />
                        <Select
                          value={participant.integrationId}
                          onValueChange={(val) => val && updateParticipant(index, { integrationId: val })}
                        >
                          <SelectTrigger>
                            <SelectValue>
                              {() =>
                                integrations.find((i) => i.id === participant.integrationId)?.name ??
                                'How is this person paged?'
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {integrations.map((integration) => (
                              <SelectItem key={integration.id} value={integration.id}>
                                {integration.name} ({integration.type})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        disabled={form.participants.length === 1}
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            participants: prev.participants.filter((_, i) => i !== index),
                          }))
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 self-start"
                  onClick={() => setForm((prev) => ({ ...prev, participants: [...prev.participants, newParticipant()] }))}
                >
                  <Plus className="h-3.5 w-3.5" /> Add person
                </Button>
                <p className="text-xs text-muted-foreground">
                  Removing someone keeps the rest of the roster and their overrides — the order below
                  is the order the pager moves in.
                </p>
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>

            <SheetFooter>
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canWrite || createSchedule.isPending || updateSchedule.isPending}>
                {createSchedule.isPending || updateSchedule.isPending ? 'Saving…' : 'Save schedule'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
