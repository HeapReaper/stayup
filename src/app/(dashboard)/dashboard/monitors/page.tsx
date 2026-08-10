'use client';

import * as React from 'react';
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Activity,
  Globe,
  Clock,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle, Copy,
} from 'lucide-react';

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
  DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
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

// Type definitie voor een Monitor
type Monitor = {
  id: string;
  name: string;
  url: string;
  type: 'HTTP' | 'Ping' | 'Port' | 'DNS';
  status: 'Up' | 'Down' | 'Degraded';
  uptime: string; // e.g. "99.98%"
  responseTime: number; // in ms
  interval: string; // e.g. "60s"
  lastChecked: string;
};

// Mock data
const initialMonitors: Monitor[] = [
  {
    id: '1',
    name: 'Production API',
    url: 'https://api.mycompany.com/health',
    type: 'HTTP',
    status: 'Up',
    uptime: '99.99%',
    responseTime: 142,
    interval: '30s',
    lastChecked: 'Zojuist',
  },
  {
    id: '2',
    name: 'Marketing Website',
    url: 'https://mycompany.com',
    type: 'HTTP',
    status: 'Up',
    uptime: '100%',
    responseTime: 210,
    interval: '60s',
    lastChecked: '1 min geleden',
  },
  {
    id: '3',
    name: 'Authentication Service',
    url: 'https://auth.mycompany.com',
    type: 'HTTP',
    status: 'Degraded',
    uptime: '98.45%',
    responseTime: 1250,
    interval: '30s',
    lastChecked: 'Zojuist',
  },
  {
    id: '4',
    name: 'Payment Gateway Proxy',
    url: 'https://payments.mycompany.com/ping',
    type: 'HTTP',
    status: 'Down',
    uptime: '94.10%',
    responseTime: 0,
    interval: '15s',
    lastChecked: '2 min geleden',
  },
];

export default function MonitorsPage() {
  const [monitors, setMonitors] = React.useState<Monitor[]>(initialMonitors);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [isAddOpen, setIsAddOpen] = React.useState(false);

  // Form state
  const [newMonitor, setNewMonitor] = React.useState({
    name: '',
    url: '',
    type: 'HTTP' as Monitor['type'],
    interval: '60s',
  });

  // Filteren op zoekopdracht & status tab
  const filteredMonitors = monitors.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.url.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' || m.status.toLowerCase() === statusFilter.toLowerCase();

    return matchesSearch && matchesStatus;
  });

  // Nieuwe monitor toevoegen
  const handleAddMonitor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMonitor.name || !newMonitor.url) return;

    const created: Monitor = {
      id: Date.now().toString(),
      name: newMonitor.name,
      url: newMonitor.url.startsWith('http') ? newMonitor.url : `https://${newMonitor.url}`,
      type: newMonitor.type,
      status: 'Up',
      uptime: '100%',
      responseTime: Math.floor(Math.random() * 150) + 50,
      interval: newMonitor.interval,
      lastChecked: 'Zojuist',
    };

    setMonitors([created, ...monitors]);
    setNewMonitor({ name: '', url: '', type: 'HTTP', interval: '60s' });
    setIsAddOpen(false);
  };

  // Monitor verwijderen
  const handleDeleteMonitor = (id: string) => {
    setMonitors(monitors.filter((m) => m.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Header & Acties */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Monitors</h1>
          <p className="text-sm text-muted-foreground">
            Manage and view the status and response times of all your endpoints.
          </p>
        </div>

        {/* Modal for new monitor */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger >
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Monitor
            </Button>
          </DialogTrigger>
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
                    value={newMonitor.name}
                    onChange={(e) => setNewMonitor({ ...newMonitor, name: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="url">URL or IP-address</Label>
                  <Input
                    id="url"
                    placeholder="https://api.example.com/health"
                    value={newMonitor.url}
                    onChange={(e) => setNewMonitor({ ...newMonitor, url: e.target.value })}
                    required
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="type">Type</Label>
                    <Select
                      value={newMonitor.type}
                      onValueChange={(val: Monitor['type']) =>
                        setNewMonitor({ ...newMonitor, type: val })
                      }
                    >
                      <SelectTrigger id="type">
                        <SelectValue />
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
                      value={newMonitor.interval}
                      onValueChange={(val) => setNewMonitor({ ...newMonitor, interval: val })}
                    >
                      <SelectTrigger id="interval">
                        <SelectValue />
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
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save & Start</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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
              <TableHead>Uptime (30d)</TableHead>
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
                  {/* Naam + URL */}
                  <TableCell>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{monitor.name}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                          {monitor.type}
                        </Badge>
                      </div>
                      <a
                        href={monitor.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground hover:underline flex items-center gap-1 mt-0.5"
                      >
                        {monitor.url}
                        <ExternalLink className="h-3 w-3" />
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
                    {monitor.uptime}
                  </TableCell>

                  {/* Latency (Response Time) */}
                  <TableCell>
                    {monitor.status === 'Down' ? (
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
                      <span>{monitor.lastChecked}</span>
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
                          <DropdownMenuItem onClick={() => alert(`URL copied to clipboard!`)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy URL
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => alert(`Edit ${page.name}`)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeletePage(page.id)}
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