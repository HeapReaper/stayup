import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';

const LIMIT = 200;

export type CheckLogItem = {
  id: string;
  monitorName: string;
  status: string;
  statusCode: number | null;
  responseTime: number | null;
  message: string | null;
  checkedAt: string;
};

export type NotificationLogItem = {
  id: string;
  integrationName: string;
  integrationType: string;
  event: string;
  message: string;
  status: string;
  error: string | null;
  incidentTitle: string | null;
  createdAt: string;
};

export type AuditLogItem = {
  id: string;
  actorName: string;
  action: string;
  target: string;
  ipAddress: string | null;
  createdAt: string;
};

export const logsRouter = createTRPCRouter({
  getChecks: protectedProcedure
    .input(z.object({ take: z.number().int().min(1).max(LIMIT).default(LIMIT) }).optional())
    .query(async ({ input }): Promise<CheckLogItem[]> => {
      const checks = await prisma.monitorCheck.findMany({
        orderBy: { checkedAt: 'desc' },
        take: input?.take ?? LIMIT,
        include: { monitor: { select: { name: true } } },
      });

      return checks.map((check) => ({
        id: check.id,
        monitorName: check.monitor.name,
        status: check.status,
        statusCode: check.statusCode,
        responseTime: check.responseTime,
        message: check.message,
        checkedAt: check.checkedAt.toISOString(),
      }));
    }),

  getNotifications: protectedProcedure
    .input(z.object({ take: z.number().int().min(1).max(LIMIT).default(LIMIT) }).optional())
    .query(async ({ input }): Promise<NotificationLogItem[]> => {
      const deliveries = await prisma.integrationDelivery.findMany({
        orderBy: { createdAt: 'desc' },
        take: input?.take ?? LIMIT,
        include: {
          integration: { select: { name: true, type: true } },
          incident: { select: { title: true } },
        },
      });

      return deliveries.map((delivery) => ({
        id: delivery.id,
        integrationName: delivery.integration.name,
        integrationType: delivery.integration.type,
        event: delivery.event,
        message: delivery.message,
        status: delivery.status,
        error: delivery.error,
        incidentTitle: delivery.incident?.title ?? null,
        createdAt: delivery.createdAt.toISOString(),
      }));
    }),

  getAuditLogs: protectedProcedure
    .input(z.object({ take: z.number().int().min(1).max(LIMIT).default(LIMIT) }).optional())
    .query(async ({ input }): Promise<AuditLogItem[]> => {
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: input?.take ?? LIMIT,
      });

      return logs.map((log) => ({
        id: log.id,
        actorName: log.actorName,
        action: log.action,
        target: log.target,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt.toISOString(),
      }));
    }),
});
