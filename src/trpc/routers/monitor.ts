import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Monitor as PrismaMonitor } from '@prisma/client';
import { createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

export const monitorTypeEnum = z.enum(['HTTP', 'Ping', 'Port', 'DNS']);
export const monitorStatusEnum = z.enum(['Up', 'Down', 'Degraded']);
export const monitorIntervalEnum = z.enum(['15s', '30s', '60s', '5m']);

export type MonitorType = z.infer<typeof monitorTypeEnum>;
export type MonitorStatus = z.infer<typeof monitorStatusEnum>;
export type MonitorInterval = z.infer<typeof monitorIntervalEnum>;

// The `type`/`status`/`interval` columns are plain strings in the DB (SQLite has no
// native enum support), but every row is written through the validated mutations
// below, so it's safe to narrow them back to their literal unions when reading.
// Dates are serialized to ISO strings here too, so the shape returned by the direct
// server-side caller (RSC) matches what actually comes back over the httpBatchLink
// (no superjson transformer is configured, so Dates go over the wire as strings).
export type Monitor = Omit<
  PrismaMonitor,
  'type' | 'status' | 'interval' | 'createdAt' | 'updatedAt' | 'lastCheckedAt'
> & {
  type: MonitorType;
  status: MonitorStatus;
  interval: MonitorInterval;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
};

function serializeMonitor(monitor: PrismaMonitor): Monitor {
  return {
    ...monitor,
    type: monitor.type as MonitorType,
    status: monitor.status as MonitorStatus,
    interval: monitor.interval as MonitorInterval,
    createdAt: monitor.createdAt.toISOString(),
    updatedAt: monitor.updatedAt.toISOString(),
    lastCheckedAt: monitor.lastCheckedAt ? monitor.lastCheckedAt.toISOString() : null,
  };
}

// Normalizes the URL/host field based on monitor type: HTTP monitors get a
// protocol prefixed if the user left it off, other monitor types (Ping/Port/DNS)
// take a bare host or IP as-is.
function normalizeUrl(type: MonitorType, url: string) {
  const trimmed = url.trim();
  if (type === 'HTTP' && !/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

const monitorBaseInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  url: z.string().trim().min(1, 'URL or host is required').max(500),
  type: monitorTypeEnum,
  interval: monitorIntervalEnum,
  port: z.coerce.number().int().min(1).max(65535).optional(),
});

const withPortRequiredForPortType = <T extends typeof monitorBaseInput>(schema: T) =>
  schema.refine((data) => data.type !== 'Port' || typeof data.port === 'number', {
    message: 'Port is required for Port monitors',
    path: ['port'],
  });

const monitorCreateInput = withPortRequiredForPortType(monitorBaseInput);
const monitorUpdateInput = withPortRequiredForPortType(
  monitorBaseInput.extend({ id: z.string() }),
);

export const monitorRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => {
    const monitors = await prisma.monitor.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return monitors.map(serializeMonitor);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const monitor = await prisma.monitor.findUnique({
        where: { id: input.id },
      });

      if (!monitor) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Monitor not found' });
      }

      return serializeMonitor(monitor);
    }),

  create: protectedProcedure
    .input(monitorCreateInput)
    .mutation(async ({ input, ctx }) => {
      const monitor = await prisma.monitor.create({
        data: {
          name: input.name,
          url: normalizeUrl(input.type, input.url),
          type: input.type,
          interval: input.interval,
          port: input.type === 'Port' ? input.port : null,
          createdById: ctx.session.user.id,
        },
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'CREATED_MONITOR',
        target: monitor.name,
        ipAddress: ctx.ipAddress,
      });

      return serializeMonitor(monitor);
    }),

  update: protectedProcedure
    .input(monitorUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.monitor.findUnique({ where: { id: input.id } });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Monitor not found' });
      }

      const monitor = await prisma.monitor.update({
        where: { id: input.id },
        data: {
          name: input.name,
          url: normalizeUrl(input.type, input.url),
          type: input.type,
          interval: input.interval,
          port: input.type === 'Port' ? input.port : null,
        },
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'UPDATED_MONITOR',
        target: monitor.name,
        ipAddress: ctx.ipAddress,
      });

      return serializeMonitor(monitor);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.monitor.findUnique({ where: { id: input.id } });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Monitor not found' });
      }

      await prisma.monitor.delete({ where: { id: input.id } });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'DELETED_MONITOR',
        target: existing.name,
        ipAddress: ctx.ipAddress,
      });

      return { id: input.id };
    }),
});
