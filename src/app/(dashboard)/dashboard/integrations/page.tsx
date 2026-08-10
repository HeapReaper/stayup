'use client';

import * as React from 'react';
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
} from 'lucide-react';

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

// Type definition for an Integration
type Integration = {
  id: string;
  name: string;
  type: 'Discord' | 'Slack' | 'Webhook' | 'Telegram' | 'Email' | 'PagerDuty';
  target: string; // Webhook URL, email address, or channel ID
  events: string[]; // e.g. ["Incidents", "Maintenance"]
  isEnabled: boolean;
  lastUsed: string;
  createdAt: string;
};

// Mock data
const initialIntegrations: Integration[] = [
  {
    id: '1',
    name: 'DevOps Alerts Channel',
    type: 'Discord',
    target: 'https://discord.com/api/webhooks/12345/abcde...',
    events: ['Incidents', 'Component Status'],
    isEnabled: true,
    lastUsed: 'Just now',
    createdAt: '2026-02-10',
  },
  {
    id: '2',
    name: '#incidents-prod',
    type: 'Slack',
    target: 'https://hooks.slack.com/services/T000/B000/XXXX',
    events: ['Incidents'],
    isEnabled: true,
    lastUsed: '2 hours ago',
    createdAt: '2026-03-01',
  },
  {
    id: '3',
    name: 'Custom Backend Event Bus',
    type: 'Webhook',
    target: 'https://api.mycompany.com/v1/uptime-events',
    events: ['Incidents', 'Monitors', 'Maintenance'],
    isEnabled: false,
    lastUsed: '3 days ago',
    createdAt: '2026-04-12',
  },
  {
    id: '4',
    name: 'On-Call Emergency Group',
    type: 'Telegram',
    target: '@mycompany_oncall_bot',
    events: ['Critical Incidents Only'],
    isEnabled: true,
    lastUsed: 'Yesterday',
    createdAt: '2026-06-20',
  },
];

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = React.useState<Integration[]>(initialIntegrations);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isAddOpen, setIsAddOpen] = React.useState(false);

  // Form state for new integration
  const [newIntegration, setNewIntegration] = React.useState({
    name: '',
    type: 'Discord' as Integration['type'],
    target: '',
  });

  // Filter by search query
  const filteredIntegrations = integrations.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.target.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Add new integration
  const handleAddIntegration = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIntegration.name || !newIntegration.target) return;

    const created: Integration = {
      id: Date.now().toString(),
      name: newIntegration.name,
      type: newIntegration.type,
      target: newIntegration.target,
      events: ['Incidents'],
      isEnabled: true,
      lastUsed: 'Never used',
      createdAt: new Date().toISOString().split('T')[0],
    };

    setIntegrations([created, ...integrations]);
    setNewIntegration({ name: '', type: 'Discord', target: '' });
    setIsAddOpen(false);
  };

  // Toggle enable status
  const handleToggleEnable = (id: string, currentVal: boolean) => {
    setIntegrations(
      integrations.map((item) =>
        item.id === id ? { ...item, isEnabled: !currentVal } : item
      )
    );
  };

  // Delete integration
  const handleDelete = (id: string) => {
    setIntegrations(integrations.filter((item) => item.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations & Webhooks</h1>
          <p className="text-sm text-muted-foreground">
            Connect Discord, Slack, Webhooks, or email to receive instant outage alerts.
          </p>
        </div>

        {/* Modal for New Integration */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Integration
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[485px]">
            <form onSubmit={handleAddIntegration}>
              <DialogHeader>
                <DialogTitle>Set Up Notification Channel</DialogTitle>
                <DialogDescription>
                  Select a platform and provide the required Webhook URL or identifier.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Name / Description</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Discord #alerts channel"
                    value={newIntegration.name}
                    onChange={(e) =>
                      setNewIntegration({ ...newIntegration, name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="type">Platform / Type</Label>
                  <Select
                    value={newIntegration.type}
                    onValueChange={(val) => {
                      if (val) setNewIntegration({ ...newIntegration, type: val });
                    }}
                  >
                    <SelectTrigger id="type">
                      <SelectValue>
                        {(val: Integration['type']) =>
                          ({
                            Discord: 'Discord Webhook',
                            Slack: 'Slack Incoming Webhook',
                            Webhook: 'Custom HTTP Webhook',
                            Telegram: 'Telegram Bot',
                            Email: 'Email Notification',
                            PagerDuty: 'PagerDuty Integration',
                          })[val]
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Discord">Discord Webhook</SelectItem>
                      <SelectItem value="Slack">Slack Incoming Webhook</SelectItem>
                      <SelectItem value="Webhook">Custom HTTP Webhook</SelectItem>
                      <SelectItem value="Telegram">Telegram Bot</SelectItem>
                      <SelectItem value="Email">Email Notification</SelectItem>
                      <SelectItem value="PagerDuty">PagerDuty Integration</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="target">
                    {newIntegration.type === 'Email'
                      ? 'Email Address'
                      : newIntegration.type === 'Telegram'
                        ? 'Chat ID / Bot Username'
                        : 'Webhook URL'}
                  </Label>
                  <Input
                    id="target"
                    placeholder={
                      newIntegration.type === 'Discord'
                        ? 'https://discord.com/api/webhooks/...'
                        : 'Enter target destination...'
                    }
                    value={newIntegration.target}
                    onChange={(e) =>
                      setNewIntegration({ ...newIntegration, target: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save & Connect</Button>
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
              <TableHead>Events</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredIntegrations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No integrations found.
                </TableCell>
              </TableRow>
            ) : (
              filteredIntegrations.map((item) => (
                <TableRow key={item.id}>
                  {/* Name & Target / URL */}
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">{item.name}</span>
                      <span className="text-xs text-muted-foreground font-mono truncate max-w-[280px] mt-0.5">
                        {item.target}
                      </span>
                    </div>
                  </TableCell>

                  {/* Type Badge */}
                  <TableCell>
                    <Badge variant="outline" className="font-normal gap-1">
                      {item.type === 'Webhook' && <Webhook className="h-3 w-3 text-purple-500" />}
                      {item.type === 'Discord' && <Bell className="h-3 w-3 text-indigo-500" />}
                      {item.type === 'Slack' && <Bell className="h-3 w-3 text-amber-500" />}
                      {item.type === 'Telegram' && <Send className="h-3 w-3 text-sky-500" />}
                      {item.type === 'Email' && <Mail className="h-3 w-3 text-emerald-500" />}
                      {item.type}
                    </Badge>
                  </TableCell>

                  {/* Triggers / Events Badges */}
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {item.events.map((evt) => (
                        <Badge key={evt} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {evt}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>

                  {/* Last Used */}
                  <TableCell className="text-xs text-muted-foreground">
                    {item.lastUsed}
                  </TableCell>

                  {/* Active Switch */}
                  <TableCell>
                    <Switch
                      checked={item.isEnabled}
                      onCheckedChange={() => handleToggleEnable(item.id, item.isEnabled)}
                    />
                  </TableCell>

                  {/* Actions Dropdown Menu */}
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
                          <DropdownMenuItem onClick={() => alert(`Test notification sent to ${item.name}!`)}>
                            <Send className="mr-2 h-4 w-4 text-sky-500" />
                            Send Test Notification
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => alert(`Edit ${item.name}`)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDelete(item.id)}
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