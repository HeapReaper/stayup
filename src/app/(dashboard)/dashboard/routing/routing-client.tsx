'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Route, BellOff } from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { NotificationRuleItem } from '@/trpc/routers/notificationRule';
import type { IntegrationSummary } from '@/trpc/routers/integration';
import type { TagSummary } from '@/trpc/routers/tag';
import type { Monitor } from '@/trpc/routers/monitor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface RoutingClientPageProps {
  initialRules: NotificationRuleItem[];
  integrations: IntegrationSummary[];
  monitors: Monitor[];
  tags: TagSummary[];
  canWrite: boolean;
}

// Base UI's <Select> has no empty-string value, so "no filter" needs a
// sentinel that can't collide with a cuid.
const ANY = '__any__';

const WEEKDAYS = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 7, short: 'Sun' },
];

type FormState = {
  name: string;
  enabled: boolean;
  action: 'Route' | 'Suppress';
  matchTagId: string;
  matchMonitorId: string;
  matchImpact: string;
  days: number[];
  fromTime: string;
  untilTime: string;
  integrationIds: string[];
};

function emptyForm(): FormState {
  return {
    name: '',
    enabled: true,
    action: 'Route',
    matchTagId: ANY,
    matchMonitorId: ANY,
    matchImpact: ANY,
    days: [],
    fromTime: '',
    untilTime: '',
    integrationIds: [],
  };
}

/** "09:00" <-> minutes since midnight, the form's unit vs the column's. */
function toMinutes(time: string): number | null {
  if (!/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function toTime(minutes: number | null): string {
  if (minutes === null) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function describeWindow(rule: NotificationRuleItem): string {
  const hours =
    rule.activeFromMinute !== null && rule.activeUntilMinute !== null
      ? `${toTime(rule.activeFromMinute)}–${toTime(rule.activeUntilMinute)}`
      : null;
  const days = rule.activeDays
    ? rule.activeDays
        .split(',')
        .map((d) => WEEKDAYS.find((w) => w.value === Number(d))?.short)
        .filter(Boolean)
        .join(' ')
    : null;

  if (!hours && !days) return 'Always';
  return [days, hours].filter(Boolean).join(', ');
}

function describeMatch(rule: NotificationRuleItem): string {
  const parts = [
    rule.matchTagName ? `tag ${rule.matchTagName}` : null,
    rule.matchMonitorName ? `monitor ${rule.matchMonitorName}` : null,
    rule.matchImpact ? `${rule.matchImpact} impact` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' + ') : 'Everything';
}

export default function RoutingClientPage({
  initialRules,
  integrations,
  monitors,
  tags,
  canWrite,
}: RoutingClientPageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const rulesQuery = useQuery({ ...trpc.notificationRule.getAll.queryOptions(), initialData: initialRules });
  const rules = rulesQuery.data;

  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm());
  const [formError, setFormError] = React.useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.notificationRule.getAll.queryKey() });

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

  const createRule = useMutation(trpc.notificationRule.create.mutationOptions({ onSuccess: onSaved, onError: onFailed }));
  const updateRule = useMutation(trpc.notificationRule.update.mutationOptions({ onSuccess: onSaved, onError: onFailed }));
  const deleteRule = useMutation(trpc.notificationRule.delete.mutationOptions({ onSuccess: invalidate, onError: onFailed }));
  const reorderRule = useMutation(trpc.notificationRule.reorder.mutationOptions({ onSuccess: invalidate, onError: onFailed }));

  const openEdit = (rule: NotificationRuleItem) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      enabled: rule.enabled,
      action: rule.action === 'Suppress' ? 'Suppress' : 'Route',
      matchTagId: rule.matchTagId ?? ANY,
      matchMonitorId: rule.matchMonitorId ?? ANY,
      matchImpact: rule.matchImpact ?? ANY,
      days: rule.activeDays ? rule.activeDays.split(',').map(Number) : [],
      fromTime: toTime(rule.activeFromMinute),
      untilTime: toTime(rule.activeUntilMinute),
      integrationIds: rule.integrationIds,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const hasFrom = form.fromTime.trim() !== '';
    const hasUntil = form.untilTime.trim() !== '';
    if (hasFrom !== hasUntil) {
      setFormError('Give both a start and an end time, or neither');
      return;
    }

    const from = hasFrom ? toMinutes(form.fromTime) : null;
    const until = hasUntil ? toMinutes(form.untilTime) : null;
    if ((hasFrom && from === null) || (hasUntil && until === null)) {
      setFormError('Times must look like 09:00');
      return;
    }

    const payload = {
      name: form.name,
      enabled: form.enabled,
      action: form.action,
      matchTagId: form.matchTagId === ANY ? null : form.matchTagId,
      matchMonitorId: form.matchMonitorId === ANY ? null : form.matchMonitorId,
      matchImpact: form.matchImpact === ANY ? null : (form.matchImpact as 'Critical' | 'Major' | 'Minor'),
      activeDays: form.days.length > 0 ? [...form.days].sort((a, b) => a - b).join(',') : null,
      activeFromMinute: from,
      activeUntilMinute: until,
      integrationIds: form.action === 'Route' ? form.integrationIds : [],
    };

    if (editingId) updateRule.mutate({ id: editingId, ...payload });
    else createRule.mutate(payload);
  };

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day],
    }));
  };

  const toggleIntegration = (id: string) => {
    setForm((prev) => ({
      ...prev,
      integrationIds: prev.integrationIds.includes(id)
        ? prev.integrationIds.filter((i) => i !== id)
        : [...prev.integrationIds, id],
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notification rules</h1>
          <p className="text-sm text-muted-foreground">
            Where an incident's alert goes when its monitor has no escalation policy. With no rules
            here, every incident broadcasts to every enabled integration, exactly as before.
          </p>
        </div>
        <Button className="gap-2" disabled={!canWrite} onClick={() => { setForm(emptyForm()); setEditingId(null); setIsFormOpen(true); }}>
          <Plus className="h-4 w-4" /> New rule
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="h-4 w-4" /> Evaluation order
          </CardTitle>
          <CardDescription>
            The first rule that applies decides, and the rest are not consulted — so put the
            exceptions above the general cases. A quiet-hours rule only applies inside its window;
            outside it, evaluation carries on to the next rule.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No rules yet — every incident broadcasts to every enabled integration.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Matches</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Then</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule, index) => (
                    <TableRow key={rule.id} className={rule.enabled ? undefined : 'opacity-50'}>
                      <TableCell className="text-muted-foreground tabular-nums">{index + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium">{rule.name}</div>
                        {!rule.enabled && <span className="text-xs text-muted-foreground">Disabled</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{describeMatch(rule)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{describeWindow(rule)}</TableCell>
                      <TableCell>
                        {rule.action === 'Suppress' ? (
                          <Badge variant="secondary" className="gap-1">
                            <BellOff className="h-3 w-3" /> Notify nobody
                          </Badge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {rule.integrationNames.map((name) => (
                              <Badge key={name} variant="outline">
                                {name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!canWrite || index === 0}
                            onClick={() => reorderRule.mutate({ id: rule.id, direction: 'up' })}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!canWrite || index === rules.length - 1}
                            onClick={() => reorderRule.mutate({ id: rule.id, direction: 'down' })}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" disabled={!canWrite} onClick={() => openEdit(rule)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!canWrite}
                            onClick={() => deleteRule.mutate({ id: rule.id })}
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
            <SheetTitle>{editingId ? 'Edit rule' : 'New rule'}</SheetTitle>
            <SheetDescription>Match an incident, then decide who hears about it and when.</SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="nr-name">Name</Label>
                <Input
                  id="nr-name"
                  placeholder="Ex. Staging office hours"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label>Enabled</Label>
                  <p className="text-xs text-muted-foreground">A disabled rule is skipped entirely.</p>
                </div>
                <Switch checked={form.enabled} onCheckedChange={(checked) => setForm({ ...form, enabled: checked })} />
              </div>

              <div className="grid gap-2">
                <Label>Matches</Label>
                <div className="grid gap-2">
                  <Select value={form.matchTagId} onValueChange={(val) => val && setForm({ ...form, matchTagId: val })}>
                    <SelectTrigger>
                      <SelectValue>
                        {(val: string) =>
                          val === ANY ? 'Any tag' : (tags.find((t) => t.id === val)?.name ?? 'Any tag')
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Any tag</SelectItem>
                      {tags.map((tag) => (
                        <SelectItem key={tag.id} value={tag.id}>
                          {tag.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={form.matchMonitorId}
                    onValueChange={(val) => val && setForm({ ...form, matchMonitorId: val })}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(val: string) =>
                          val === ANY ? 'Any monitor' : (monitors.find((m) => m.id === val)?.name ?? 'Any monitor')
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Any monitor</SelectItem>
                      {monitors.map((monitor) => (
                        <SelectItem key={monitor.id} value={monitor.id}>
                          {monitor.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={form.matchImpact} onValueChange={(val) => val && setForm({ ...form, matchImpact: val })}>
                    <SelectTrigger>
                      <SelectValue>{(val: string) => (val === ANY ? 'Any impact' : val)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Any impact</SelectItem>
                      <SelectItem value="Critical">Critical</SelectItem>
                      <SelectItem value="Major">Major</SelectItem>
                      <SelectItem value="Minor">Minor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Every filter you set must hold. Leaving all three on "any" matches every incident,
                  which is how an instance-wide quiet-hours rule is written.
                </p>
              </div>

              <div className="grid gap-2">
                <Label>Active window</Label>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((day) => (
                    <Button
                      key={day.value}
                      type="button"
                      size="sm"
                      variant={form.days.includes(day.value) ? 'default' : 'outline'}
                      onClick={() => toggleDay(day.value)}
                    >
                      {day.short}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="09:00"
                    className="w-28"
                    value={form.fromTime}
                    onChange={(e) => setForm({ ...form, fromTime: e.target.value })}
                  />
                  <span className="text-sm text-muted-foreground">until</span>
                  <Input
                    placeholder="17:00"
                    className="w-28"
                    value={form.untilTime}
                    onChange={(e) => setForm({ ...form, untilTime: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Evaluated in the instance timezone (Settings → General). Leave everything blank for
                  "always". An end before the start wraps past midnight — 22:00 until 06:00 — and the
                  weekday is the day the window opened on.
                </p>
              </div>

              <div className="grid gap-2">
                <Label>Then</Label>
                <Select
                  value={form.action}
                  onValueChange={(val) => val && setForm({ ...form, action: val as 'Route' | 'Suppress' })}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(val: string) =>
                        val === 'Suppress' ? 'Notify nobody (quiet hours)' : 'Notify only these integrations'
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Route">Notify only these integrations</SelectItem>
                    <SelectItem value="Suppress">Notify nobody (quiet hours)</SelectItem>
                  </SelectContent>
                </Select>

                {form.action === 'Route' ? (
                  <div className="space-y-2 rounded-lg border p-3">
                    {integrations.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No integrations configured yet.</p>
                    ) : (
                      integrations.map((integration) => (
                        <label key={integration.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={form.integrationIds.includes(integration.id)}
                            onCheckedChange={() => toggleIntegration(integration.id)}
                          />
                          {integration.name}
                          <span className="text-xs text-muted-foreground">({integration.type})</span>
                        </label>
                      ))
                    )}
                    <p className="text-xs text-muted-foreground">
                      Outside the window this rule notifies nobody — that is what makes "only during
                      office hours" mean "and nothing outside them".
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Inside the window, matching incidents notify nobody. Outside it this rule is
                    skipped entirely, so daytime behaviour is unchanged.
                  </p>
                )}
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>

            <SheetFooter>
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canWrite || createRule.isPending || updateRule.isPending}>
                {createRule.isPending || updateRule.isPending ? 'Saving…' : 'Save rule'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
