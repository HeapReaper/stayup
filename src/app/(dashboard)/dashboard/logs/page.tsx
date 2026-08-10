'use client';

import * as React from 'react';
import {
  Search,
  Activity,
  BellRing,
  ShieldCheck,
  MoreHorizontal,
  Eye,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Mail,
  Webhook,
  Bell,
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
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Log item types
type CheckLog = {
  id: string;
  timestamp: string;
  monitorName: string;
  statusCode: number;
  responseTime: number;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  ipAddress: string;
};

type AlertLog = {
  id: string;
  timestamp: string;
  channel: 'Discord' | 'Slack' | 'Email' | 'Webhook';
  event: string;
  recipient: string;
  status: 'DELIVERED' | 'FAILED';
};

type NotificationLog = {
  id: string;
  timestamp: string;
  channel: 'Discord' | 'Slack' | 'Email' | 'Webhook' | 'Telegram';
  type: 'Incident Alert' | 'Maintenance' | 'System Update' | 'SSL Expiry';
  recipient: string;
  message: string;
  status: 'SENT' | 'PENDING' | 'FAILED';
};

type AuditLog = {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  target: string;
  ipAddress: string;
};

// Mock data
const mockCheckLogs: CheckLog[] = [
  {
    id: 'chk-1',
    timestamp: '2026-08-10 18:35:12',
    monitorName: 'Production API',
    statusCode: 200,
    responseTime: 142,
    status: 'SUCCESS',
    ipAddress: '192.168.1.10',
  },
  {
    id: 'chk-2',
    timestamp: '2026-08-10 18:34:50',
    monitorName: 'Payment Gateway Proxy',
    statusCode: 504,
    responseTime: 30000,
    status: 'TIMEOUT',
    ipAddress: '192.168.1.12',
  },
  {
    id: 'chk-3',
    timestamp: '2026-08-10 18:33:15',
    monitorName: 'Marketing Website',
    statusCode: 200,
    responseTime: 210,
    status: 'SUCCESS',
    ipAddress: '192.168.1.10',
  },
  {
    id: 'chk-4',
    timestamp: '2026-08-10 18:31:02',
    monitorName: 'Authentication Service',
    statusCode: 500,
    responseTime: 1250,
    status: 'FAILED',
    ipAddress: '192.168.1.15',
  },
];

const mockAlertLogs: AlertLog[] = [
  {
    id: 'alt-1',
    timestamp: '2026-08-10 18:35:00',
    channel: 'Discord',
    event: 'Incident Created: Payment Gateway Timeout',
    recipient: '#devops-alerts',
    status: 'DELIVERED',
  },
  {
    id: 'alt-2',
    timestamp: '2026-08-10 18:31:10',
    channel: 'Slack',
    event: 'High Latency Alert',
    recipient: '#incidents-prod',
    status: 'DELIVERED',
  },
  {
    id: 'alt-3',
    timestamp: '2026-08-10 17:45:22',
    channel: 'Email',
    event: 'SSL Expiry Warning',
    recipient: 'admin@acme.com',
    status: 'FAILED',
  },
];

const mockNotificationLogs: NotificationLog[] = [
  {
    id: 'notif-1',
    timestamp: '2026-08-10 18:35:05',
    channel: 'Discord',
    type: 'Incident Alert',
    recipient: 'Webhook: #devops-alerts',
    message: 'CRITICAL: Payment Gateway Proxy is DOWN (504 Timeout)',
    status: 'SENT',
  },
  {
    id: 'notif-2',
    timestamp: '2026-08-10 18:32:00',
    channel: 'Email',
    type: 'SSL Expiry',
    recipient: 'dev-team@acme.com',
    message: 'SSL Certificate for auth.acme.com expires in 14 days',
    status: 'SENT',
  },
  {
    id: 'notif-3',
    timestamp: '2026-08-10 17:10:45',
    channel: 'Slack',
    type: 'Maintenance',
    recipient: '#general',
    message: 'Scheduled maintenance starting in 15 minutes',
    status: 'SENT',
  },
  {
    id: 'notif-4',
    timestamp: '2026-08-10 15:00:12',
    channel: 'Webhook',
    type: 'System Update',
    recipient: 'https://api.mycompany.com/webhook',
    message: 'Payload dispatch failed: Remote server returned 502 Bad Gateway',
    status: 'FAILED',
  },
];

const mockAuditLogs: AuditLog[] = [
  {
    id: 'aud-1',
    timestamp: '2026-08-10 16:12:00',
    user: 'Alex de Vries',
    action: 'CREATED_MONITOR',
    target: 'Payment Gateway Proxy',
    ipAddress: '82.170.12.44',
  },
  {
    id: 'aud-2',
    timestamp: '2026-08-10 14:05:33',
    user: 'Sophie Bakker',
    action: 'UPDATED_SMTP_SETTINGS',
    target: 'System Settings',
    ipAddress: '145.93.201.11',
  },
  {
    id: 'aud-3',
    timestamp: '2026-08-10 11:20:10',
    user: 'Alex de Vries',
    action: 'DELETED_USER',
    target: 'test-user@acme.com',
    ipAddress: '82.170.12.44',
  },
];

export default function LogsPage() {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedLog, setSelectedLog] = React.useState<any | null>(null);

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Logs & Audit Trail</h1>
          <p className="text-sm text-muted-foreground">
            Overview of automated check runs, alert triggers, notifications, and administrative actions.
          </p>
        </div>

        <Button variant="outline" className="gap-2 shrink-0">
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative w-full sm:w-80">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search logs..."
          className="pl-8"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Tabs Navigation */}
      <Tabs defaultValue="checks" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 lg:w-auto">
          <TabsTrigger value="checks" className="gap-2">
            <Activity className="h-4 w-4" /> Check Logs
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <BellRing className="h-4 w-4" /> Alert Logs
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Send className="h-4 w-4" /> Notification Logs
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <ShieldCheck className="h-4 w-4" /> Audit Logs
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: CHECK LOGS */}
        <TabsContent value="checks">
          <div className="border rounded-lg bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Monitor</TableHead>
                  <TableHead>Status Code</TableHead>
                  <TableHead>Response Time</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockCheckLogs
                  .filter(
                    (log) =>
                      log.monitorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      log.status.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.timestamp}
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {log.monitorName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {log.statusCode}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.responseTime > 0 ? `${log.responseTime} ms` : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            log.status === 'SUCCESS'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 gap-1'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 gap-1'
                          }
                        >
                          {log.status === 'SUCCESS' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>Options</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => setSelectedLog(log)}>
                                <Eye className="mr-2 h-4 w-4" /> View Details
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* TAB 2: ALERT LOGS */}
        <TabsContent value="alerts">
          <div className="border rounded-lg bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockAlertLogs
                  .filter(
                    (log) =>
                      log.event.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      log.recipient.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.timestamp}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.channel}</Badge>
                      </TableCell>
                      <TableCell className="font-medium text-sm">{log.event}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {log.recipient}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            log.status === 'DELIVERED'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 gap-1'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 gap-1'
                          }
                        >
                          {log.status === 'DELIVERED' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <AlertTriangle className="h-3 w-3" />
                          )}
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>Options</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => setSelectedLog(log)}>
                                <Eye className="mr-2 h-4 w-4" /> View Details
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* TAB 3: NOTIFICATION LOGS */}
        <TabsContent value="notifications">
          <div className="border rounded-lg bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Recipient / Endpoint</TableHead>
                  <TableHead>Message / Payload</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockNotificationLogs
                  .filter(
                    (log) =>
                      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      log.recipient.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      log.type.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.timestamp}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1 font-normal">
                          {log.channel === 'Discord' && <Bell className="h-3 w-3 text-indigo-500" />}
                          {log.channel === 'Slack' && <Bell className="h-3 w-3 text-amber-500" />}
                          {log.channel === 'Email' && <Mail className="h-3 w-3 text-emerald-500" />}
                          {log.channel === 'Webhook' && <Webhook className="h-3 w-3 text-purple-500" />}
                          {log.channel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {log.type}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                        {log.recipient}
                      </TableCell>
                      <TableCell className="text-xs truncate max-w-[300px]">
                        {log.message}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            log.status === 'SENT'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 gap-1'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 gap-1'
                          }
                        >
                          {log.status === 'SENT' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>Options</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => setSelectedLog(log)}>
                                <Eye className="mr-2 h-4 w-4" /> View Payload
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* TAB 4: AUDIT LOGS */}
        <TabsContent value="audit">
          <div className="border rounded-lg bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockAuditLogs
                  .filter(
                    (log) =>
                      log.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      log.action.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.timestamp}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{log.user}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{log.target}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.ipAddress}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Log Detail Modal */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Log Details</DialogTitle>
            <DialogDescription>
              Raw payload and metadata for Log ID: {selectedLog?.id}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <pre className="p-4 rounded-lg bg-muted text-xs font-mono overflow-x-auto">
              {JSON.stringify(selectedLog, null, 2)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}