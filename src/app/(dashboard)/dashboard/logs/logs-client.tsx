'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Activity,
  ShieldCheck,
  Send,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Mail,
  Webhook,
  Bell,
} from 'lucide-react';

import { useTRPC } from '@/trpc/client';
import type { CheckLogItem, NotificationLogItem, AuditLogItem } from '@/trpc/routers/logs';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface LogsClientPageProps {
  initialChecks: CheckLogItem[];
  initialNotifications: NotificationLogItem[];
  initialAuditLogs: AuditLogItem[];
}

function formatDateTime(date: string) {
  return new Date(date).toLocaleString();
}

/** Client-side CSV export — no backend endpoint needed for this. */
function downloadCsv(filename: string, rows: Record<string, string>[]) {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h] ?? '')).join(',')),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function StatusBadge({ status, ok, warn }: { status: string; ok: string[]; warn?: string[] }) {
  const isOk = ok.includes(status);
  const isWarn = warn?.includes(status);

  return (
    <Badge
      variant="secondary"
      className={
        isOk
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 gap-1'
          : isWarn
            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 gap-1'
            : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 gap-1'
      }
    >
      {isOk ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : isWarn ? (
        <Clock className="h-3 w-3" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
      {status}
    </Badge>
  );
}

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  Discord: <Bell className="h-3 w-3 text-indigo-500" />,
  Slack: <Bell className="h-3 w-3 text-amber-500" />,
  Email: <Mail className="h-3 w-3 text-emerald-500" />,
  Webhook: <Webhook className="h-3 w-3 text-purple-500" />,
  Telegram: <Send className="h-3 w-3 text-sky-500" />,
  PagerDuty: <AlertTriangle className="h-3 w-3 text-rose-500" />,
};

export default function LogsClientPage({
  initialChecks,
  initialNotifications,
  initialAuditLogs,
}: LogsClientPageProps) {
  const trpc = useTRPC();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [activeTab, setActiveTab] = React.useState('checks');

  const checksQuery = useQuery({ ...trpc.logs.getChecks.queryOptions(), initialData: initialChecks });
  const notificationsQuery = useQuery({
    ...trpc.logs.getNotifications.queryOptions(),
    initialData: initialNotifications,
  });
  const auditQuery = useQuery({ ...trpc.logs.getAuditLogs.queryOptions(), initialData: initialAuditLogs });

  const q = searchQuery.toLowerCase();

  const filteredChecks = checksQuery.data.filter(
    (log) => log.monitorName.toLowerCase().includes(q) || log.status.toLowerCase().includes(q),
  );
  const filteredNotifications = notificationsQuery.data.filter(
    (log) =>
      log.integrationName.toLowerCase().includes(q) ||
      log.message.toLowerCase().includes(q) ||
      log.event.toLowerCase().includes(q),
  );
  const filteredAudit = auditQuery.data.filter(
    (log) => log.actorName.toLowerCase().includes(q) || log.action.toLowerCase().includes(q),
  );

  const handleExport = () => {
    if (activeTab === 'checks') {
      downloadCsv(
        'check-logs.csv',
        filteredChecks.map((log) => ({
          Timestamp: log.checkedAt,
          Monitor: log.monitorName,
          Status: log.status,
          'Status Code': String(log.statusCode ?? ''),
          'Response Time (ms)': String(log.responseTime ?? ''),
          Message: log.message ?? '',
        })),
      );
    } else if (activeTab === 'notifications') {
      downloadCsv(
        'notification-logs.csv',
        filteredNotifications.map((log) => ({
          Timestamp: log.createdAt,
          Integration: log.integrationName,
          Type: log.integrationType,
          Event: log.event,
          Status: log.status,
          Message: log.message,
          Error: log.error ?? '',
        })),
      );
    } else {
      downloadCsv(
        'audit-logs.csv',
        filteredAudit.map((log) => ({
          Timestamp: log.createdAt,
          User: log.actorName,
          Action: log.action,
          Target: log.target,
          'IP Address': log.ipAddress ?? '',
        })),
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Logs & Audit Trail</h1>
          <p className="text-sm text-muted-foreground">
            Overview of automated check runs, outgoing notifications, and administrative actions.
          </p>
        </div>

        <Button variant="outline" className="gap-2 shrink-0" onClick={handleExport}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="relative w-full sm:w-80">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search logs..."
          className="pl-8"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:w-auto">
          <TabsTrigger value="checks" className="gap-2">
            <Activity className="h-4 w-4" /> Check Logs
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Send className="h-4 w-4" /> Notifications
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <ShieldCheck className="h-4 w-4" /> Audit Logs
          </TabsTrigger>
        </TabsList>

        {/* CHECK LOGS */}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredChecks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No check logs found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredChecks.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatDateTime(log.checkedAt)}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{log.monitorName}</TableCell>
                      <TableCell>
                        {log.statusCode ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            {log.statusCode}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.responseTime !== null ? `${log.responseTime} ms` : '-'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={log.status} ok={['Up']} warn={['Degraded']} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* NOTIFICATION LOGS */}
        <TabsContent value="notifications">
          <div className="border rounded-lg bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNotifications.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No notifications sent yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredNotifications.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1 font-normal">
                          {CHANNEL_ICON[log.integrationType]}
                          {log.integrationName}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-medium">{log.event}</TableCell>
                      <TableCell className="text-xs truncate max-w-[320px]" title={log.message}>
                        {log.status === 'Failed' && log.error ? log.error : log.message}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={log.status} ok={['Sent']} warn={['Pending']} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* AUDIT LOGS */}
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
                {filteredAudit.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No audit events yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAudit.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{log.actorName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{log.target}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.ipAddress ?? '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
