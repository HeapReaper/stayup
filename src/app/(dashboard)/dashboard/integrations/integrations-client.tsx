'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Webhook,
  Send,
  Bell,
  Mail,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { IntegrationSummary, IntegrationType } from '@/trpc/routers/integration';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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

interface IntegrationsClientPageProps {
  initialIntegrations: IntegrationSummary[];
}

const TYPE_LABELS: Record<IntegrationType, string> = {
  Discord: 'Discord Webhook',
  Slack: 'Slack Incoming Webhook',
  Webhook: 'Custom HTTP Webhook',
  Telegram: 'Telegram Bot',
  Email: 'Email Notification',
  PagerDuty: 'PagerDuty Integration',
};

const TYPE_ICON: Record<IntegrationType, React.ReactNode> = {
  Discord: <Bell className="h-3 w-3 text-indigo-500" />,
  Slack: <Bell className="h-3 w-3 text-amber-500" />,
  Webhook: <Webhook className="h-3 w-3 text-purple-500" />,
  Telegram: <Send className="h-3 w-3 text-sky-500" />,
  Email: <Mail className="h-3 w-3 text-emerald-500" />,
  PagerDuty: <AlertTriangle className="h-3 w-3 text-rose-500" />,
};

type FormState = {
  name: string;
  type: IntegrationType;
  target: string;
  secret: string;
  enabled: boolean;
};

function emptyForm(): FormState {
  return { name: '', type: 'Discord', target: '', secret: '', enabled: true };
}

function targetLabel(type: IntegrationType) {
  if (type === 'Email') return 'Email Address';
  if (type === 'Telegram') return 'Chat ID';
  if (type === 'PagerDuty') return 'Integration / Routing Key';
  return 'Webhook URL';
}

function targetPlaceholder(type: IntegrationType) {
  if (type === 'Discord') return 'https://discord.com/api/webhooks/...';
  if (type === 'Slack') return 'https://hooks.slack.com/services/...';
  if (type === 'Email') return 'alerts@example.com';
  if (type === 'Telegram') return '-1001234567890';
  if (type === 'PagerDuty') return 'R0X1Y2Z3...';
  return 'https://api.example.com/webhook';
}

function formatDateTime(date: string) {
  return new Date(date).toLocaleString();
}

function DeliveryBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={
        status === 'Sent'
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 gap-1'
          : status === 'Pending'
            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 gap-1'
            : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 gap-1'
      }
    >
      {status === 'Sent' ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : status === 'Pending' ? (
        <Clock className="h-3 w-3" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
      {status}
    </Badge>
  );
}

export default function IntegrationsClientPage({ initialIntegrations }: IntegrationsClientPageProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const integrationsQuery = useQuery({
    ...trpc.integration.getAll.queryOptions(),
    initialData: initialIntegrations,
  });
  const integrations = integrationsQuery.data;

  const [searchQuery, setSearchQuery] = React.useState('');
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm());
  const [formError, setFormError] = React.useState<string | null>(null);
  const [testFeedback, setTestFeedback] = React.useState<{ id: string; ok: boolean; message: string } | null>(null);

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: trpc.integration.getAll.queryKey() });

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const createIntegration = useMutation(
    trpc.integration.create.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const updateIntegration = useMutation(
    trpc.integration.update.mutationOptions({
      onSuccess: () => {
        invalidateAll();
        closeForm();
      },
      onError: (error) => setFormError(error.message),
    }),
  );

  const deleteIntegration = useMutation(
    trpc.integration.delete.mutationOptions({ onSuccess: () => invalidateAll() }),
  );

  const toggleEnabled = useMutation(
    trpc.integration.toggleEnabled.mutationOptions({ onSuccess: () => invalidateAll() }),
  );

  const testSend = useMutation(
    trpc.integration.testSend.mutationOptions({
      onSuccess: (_, variables) => {
        invalidateAll();
        setTestFeedback({ id: variables.id, ok: true, message: 'Test notification sent successfully!' });
      },
      onError: (error, variables) => {
        invalidateAll();
        setTestFeedback({ id: variables.id, ok: false, message: error.message });
      },
    }),
  );

  React.useEffect(() => {
    if (!testFeedback) return;
    const timer = setTimeout(() => setTestFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [testFeedback]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (integration: IntegrationSummary) => {
    setEditingId(integration.id);
    setForm({
      name: integration.name,
      type: integration.type,
      target: integration.target,
      secret: '', // never sent back down; leave blank to keep the existing one
      enabled: integration.enabled,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.target) return;

    const payload = {
      name: form.name,
      type: form.type,
      target: form.target,
      secret: form.secret || undefined,
      enabled: form.enabled,
    };

    if (editingId) {
      updateIntegration.mutate({ id: editingId, ...payload });
    } else {
      createIntegration.mutate(payload);
    }
  };

  const filteredIntegrations = integrations.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.target.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const isSaving = createIntegration.isPending || updateIntegration.isPending;

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations & Webhooks</h1>
          <p className="text-sm text-muted-foreground">
            Connect Discord, Slack, Webhooks, Telegram, Email, or PagerDuty to receive instant outage alerts.
          </p>
        </div>

        <Dialog
          open={isFormOpen}
          onOpenChange={(open) => {
            if (!open) closeForm();
          }}
        >
          <DialogTrigger
            render={
              <Button className="gap-2" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Add Integration
              </Button>
            }
          />
          <DialogContent className="sm:max-w-[485px]">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit Notification Channel' : 'Set Up Notification Channel'}</DialogTitle>
                <DialogDescription>
                  Select a platform and provide the required Webhook URL or identifier. Every incident report
                  and update is sent to every enabled channel below.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Name / Description</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Discord #alerts channel"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="type">Platform / Type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(val) => {
                      if (val) setForm({ ...form, type: val as IntegrationType });
                    }}
                  >
                    <SelectTrigger id="type">
                      <SelectValue>{(val: IntegrationType) => TYPE_LABELS[val]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TYPE_LABELS) as IntegrationType[]).map((type) => (
                        <SelectItem key={type} value={type}>
                          {TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="target">{targetLabel(form.type)}</Label>
                  <Input
                    id="target"
                    placeholder={targetPlaceholder(form.type)}
                    value={form.target}
                    onChange={(e) => setForm({ ...form, target: e.target.value })}
                    required
                  />
                </div>
                {form.type === 'Telegram' && (
                  <div className="grid gap-2">
                    <Label htmlFor="secret">Bot Token</Label>
                    <Input
                      id="secret"
                      type="password"
                      placeholder={editingId ? 'Leave blank to keep the current token' : '123456:ABC-DEF...'}
                      value={form.secret}
                      onChange={(e) => setForm({ ...form, secret: e.target.value })}
                      required={!editingId}
                    />
                    <p className="text-xs text-muted-foreground">
                      From @BotFather. The chat above must have started a conversation with the bot.
                    </p>
                  </div>
                )}

                {formError && <p className="text-sm text-destructive">{formError}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeForm}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Save & Connect'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search Bar */}
      <div className="relative w-full sm:w-80">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by channel, type, or URL..."
          className="pl-8"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Integrations Table */}
      <div className="border rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel / Integration</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Last Delivery</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredIntegrations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No integrations found.
                </TableCell>
              </TableRow>
            ) : (
              filteredIntegrations.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">{item.name}</span>
                      <span className="text-xs text-muted-foreground font-mono truncate max-w-[280px] mt-0.5">
                        {item.target}
                      </span>
                      {testFeedback?.id === item.id && (
                        <span
                          className={`text-xs mt-0.5 ${testFeedback.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
                        >
                          {testFeedback.message}
                        </span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    <Badge variant="outline" className="font-normal gap-1">
                      {TYPE_ICON[item.type]}
                      {item.type}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    {item.lastDelivery ? (
                      <div className="flex flex-col gap-1">
                        <DeliveryBadge status={item.lastDelivery.status} />
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(item.lastDelivery.createdAt)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Never used</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <Switch
                      checked={item.enabled}
                      onCheckedChange={(checked) => toggleEnabled.mutate({ id: item.id, enabled: checked })}
                    />
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
                          <DropdownMenuItem
                            onClick={() => testSend.mutate({ id: item.id })}
                            disabled={testSend.isPending}
                          >
                            <Send className="mr-2 h-4 w-4 text-sky-500" />
                            Send Test Notification
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(item)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => deleteIntegration.mutate({ id: item.id })}
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
