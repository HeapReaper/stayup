'use client';

import * as React from 'react';
import {
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Siren,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Flame,
  UserCheck,
  MessageSquare,
} from 'lucide-react';

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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Type definition for an Incident
type Incident = {
  id: string;
  title: string;
  monitorName: string;
  impact: 'Critical' | 'Major' | 'Minor';
  status: 'Investigating' | 'Identified' | 'Monitoring' | 'Resolved';
  assignee: string;
  duration: string;
  startedAt: string;
};

// Mock data
const initialIncidents: Incident[] = [
  {
    id: '1',
    title: 'Payment Gateway Connection Timeout',
    monitorName: 'Payment Gateway Proxy',
    impact: 'Critical',
    status: 'Investigating',
    assignee: 'Alex de Vries',
    duration: '14 min',
    startedAt: 'Today, 14:22',
  },
  {
    id: '2',
    title: 'High Latency on Authentication',
    monitorName: 'Authentication Service',
    impact: 'Major',
    status: 'Identified',
    assignee: 'Sophie Bakker',
    duration: '45 min',
    startedAt: 'Today, 13:51',
  },
  {
    id: '3',
    title: 'Database Replica Lag',
    monitorName: 'Production API',
    impact: 'Minor',
    status: 'Resolved',
    assignee: 'Lars Jansen',
    duration: '1h 12m',
    startedAt: 'Yesterday, 18:30',
  },
  {
    id: '4',
    title: 'DNS Resolution Failure (EU Region)',
    monitorName: 'Marketing Website',
    impact: 'Major',
    status: 'Resolved',
    assignee: 'Alex de Vries',
    duration: '22 min',
    startedAt: 'Aug 08, 09:15',
  },
];

export default function IncidentsPage() {
  const [incidents, setIncidents] = React.useState<Incident[]>(initialIncidents);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [isAddOpen, setIsAddOpen] = React.useState(false);

  // Form state for new incident
  const [newIncident, setNewIncident] = React.useState({
    title: '',
    monitorName: '',
    impact: 'Major' as Incident['impact'],
    assignee: 'Alex de Vries',
    description: '',
  });

  // Filter by search query & status tab
  const filteredIncidents = incidents.filter((inc) => {
    const matchesSearch =
      inc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inc.monitorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inc.assignee.toLowerCase().includes(searchQuery.toLowerCase());

    const isOngoing = inc.status !== 'Resolved';
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'ongoing' && isOngoing) ||
      (statusFilter === 'resolved' && inc.status === 'Resolved');

    return matchesSearch && matchesStatus;
  });

  // Manually report a new incident
  const handleAddIncident = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIncident.title || !newIncident.monitorName) return;

    const created: Incident = {
      id: Date.now().toString(),
      title: newIncident.title,
      monitorName: newIncident.monitorName,
      impact: newIncident.impact,
      status: 'Investigating',
      assignee: newIncident.assignee,
      duration: 'Just started',
      startedAt: 'Just now',
    };

    setIncidents([created, ...incidents]);
    setNewIncident({
      title: '',
      monitorName: '',
      impact: 'Major',
      assignee: 'Alex de Vries',
      description: '',
    });
    setIsAddOpen(false);
  };

  // Mark incident as resolved
  const handleResolveIncident = (id: string) => {
    setIncidents(
      incidents.map((inc) =>
        inc.id === id ? { ...inc, status: 'Resolved' } : inc
      )
    );
  };

  // Delete incident
  const handleDeleteIncident = (id: string) => {
    setIncidents(incidents.filter((inc) => inc.id !== id));
  };

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
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" className="gap-2">
              <Siren className="h-4 w-4" />
              Report Incident
            </Button>
          </DialogTrigger>
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
                    value={newIncident.title}
                    onChange={(e) =>
                      setNewIncident({ ...newIncident, title: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="monitor">Affected Service / Monitor</Label>
                  <Input
                    id="monitor"
                    placeholder="e.g. Payment Gateway Proxy"
                    value={newIncident.monitorName}
                    onChange={(e) =>
                      setNewIncident({ ...newIncident, monitorName: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="impact">Impact Level</Label>
                    <Select
                      value={newIncident.impact}
                      onValueChange={(val: Incident['impact']) =>
                        setNewIncident({ ...newIncident, impact: val })
                      }
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
                    <Label htmlFor="assignee">Assigned To</Label>
                    <Select
                      value={newIncident.assignee}
                      onValueChange={(val) =>
                        setNewIncident({ ...newIncident, assignee: val })
                      }
                    >
                      <SelectTrigger id="assignee">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Alex de Vries">Alex de Vries</SelectItem>
                        <SelectItem value="Sophie Bakker">Sophie Bakker</SelectItem>
                        <SelectItem value="Lars Jansen">Lars Jansen</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Initial Status Update</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe the current situation and what is being investigated..."
                    value={newIncident.description}
                    onChange={(e) =>
                      setNewIncident({ ...newIncident, description: e.target.value })
                    }
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive">
                  Create Incident
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search Bar & Status Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title, service, or responder..."
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
              <TableHead>Incident & Service</TableHead>
              <TableHead>Impact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Responder</TableHead>
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
                <TableRow key={incident.id}>
                  {/* Title & Service */}
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">{incident.title}</span>
                      <span className="text-xs text-muted-foreground mt-0.5">
                        Monitor: {incident.monitorName}
                      </span>
                    </div>
                  </TableCell>

                  {/* Impact Badge */}
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        incident.impact === 'Critical'
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 gap-1'
                          : incident.impact === 'Major'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1'
                            : 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 gap-1'
                      }
                    >
                      {incident.impact === 'Critical' && <Flame className="h-3 w-3" />}
                      {incident.impact === 'Major' && <AlertTriangle className="h-3 w-3" />}
                      {incident.impact}
                    </Badge>
                  </TableCell>

                  {/* Status Badge */}
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        incident.status === 'Resolved'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1.5'
                          : incident.status === 'Investigating'
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20 gap-1.5 animate-pulse'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20 gap-1.5'
                      }
                    >
                      {incident.status === 'Resolved' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Clock className="h-3.5 w-3.5" />
                      )}
                      {incident.status}
                    </Badge>
                  </TableCell>

                  {/* Responder / Assignee */}
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <UserCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span>{incident.assignee}</span>
                    </div>
                  </TableCell>

                  {/* Duration / Started at */}
                  <TableCell>
                    <div className="flex flex-col text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{incident.duration}</span>
                      <span>{incident.startedAt}</span>
                    </div>
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
                          {incident.status !== 'Resolved' && (
                            <DropdownMenuItem onClick={() => handleResolveIncident(incident.id)}>
                              <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                              Mark as Resolved
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => alert(`Add status update for ${incident.title}`)}>
                            <MessageSquare className="mr-2 h-4 w-4" />
                            Add Status Update
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => alert(`Edit ${incident.title}`)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
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