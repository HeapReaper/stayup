import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure, capabilityProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

/** Maintenance windows: Admin and Member. */
const writeMaintenance = capabilityProcedure('maintenance:write');

export const maintenanceStatusEnum = z.enum(['Scheduled', 'Active', 'Completed', 'Cancelled']);
export type MaintenanceStatus = z.infer<typeof maintenanceStatusEnum>;

export type MaintenanceWindowSummary = {
  id: string;
  title: string;
  message: string | null;
  status: MaintenanceStatus;
  startsAt: string;
  endsAt: string;
  monitors: { id: string; name: string }[];
  createdBy: { id: string; name: string } | null;
  createdAt: string;
};

/** Status isn't stored — it's always derived from now vs startsAt/endsAt/cancelledAt. */
function deriveStatus(
  window: { startsAt: Date; endsAt: Date; cancelledAt: Date | null },
  now: Date = new Date(),
): MaintenanceStatus {
  if (window.cancelledAt) return 'Cancelled';
  if (now < window.startsAt) return 'Scheduled';
  if (now > window.endsAt) return 'Completed';
  return 'Active';
}

const withMonitorsAndCreator = {
  monitors: { include: { monitor: { select: { id: true, name: true } } } },
  createdBy: { select: { id: true, name: true } },
} as const;

function serialize(window: {
  id: string;
  title: string;
  message: string | null;
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
  createdAt: Date;
  createdBy: { id: string; name: string } | null;
  monitors: { monitor: { id: string; name: string } }[];
}): MaintenanceWindowSummary {
  return {
    id: window.id,
    title: window.title,
    message: window.message,
    status: deriveStatus(window),
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    monitors: window.monitors.map((m) => m.monitor),
    createdBy: window.createdBy,
    createdAt: window.createdAt.toISOString(),
  };
}

const maintenanceInput = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    message: z.string().trim().max(2000).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    monitorIds: z.array(z.string()).min(1, 'Select at least one monitor'),
  })
  .refine((data) => data.endsAt > data.startsAt, {
    message: 'End time must be after the start time',
    path: ['endsAt'],
  });

export const maintenanceRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => {
    const windows = await prisma.maintenanceWindow.findMany({
      orderBy: { startsAt: 'desc' },
      include: withMonitorsAndCreator,
    });

    return windows.map(serialize);
  }),

  create: writeMaintenance.input(maintenanceInput).mutation(async ({ input, ctx }) => {
    const window = await prisma.maintenanceWindow.create({
      data: {
        title: input.title,
        message: input.message || null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdById: ctx.session.user.id,
        monitors: { create: input.monitorIds.map((monitorId) => ({ monitorId })) },
      },
      include: withMonitorsAndCreator,
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'CREATED_MAINTENANCE_WINDOW',
      target: window.title,
      ipAddress: ctx.ipAddress,
    });

    return serialize(window);
  }),

  update: writeMaintenance
    .input(maintenanceInput.extend({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.maintenanceWindow.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Maintenance window not found' });

      const window = await prisma.$transaction(async (tx) => {
        await tx.maintenanceWindowMonitor.deleteMany({ where: { maintenanceWindowId: input.id } });

        return tx.maintenanceWindow.update({
          where: { id: input.id },
          data: {
            title: input.title,
            message: input.message || null,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            monitors: { create: input.monitorIds.map((monitorId) => ({ monitorId })) },
          },
          include: withMonitorsAndCreator,
        });
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'UPDATED_MAINTENANCE_WINDOW',
        target: window.title,
        ipAddress: ctx.ipAddress,
      });

      return serialize(window);
    }),

  cancel: writeMaintenance.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.maintenanceWindow.findUnique({ where: { id: input.id } });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Maintenance window not found' });

    const window = await prisma.maintenanceWindow.update({
      where: { id: input.id },
      data: { cancelledAt: new Date() },
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'CANCELLED_MAINTENANCE_WINDOW',
      target: window.title,
      ipAddress: ctx.ipAddress,
    });

    return { id: window.id };
  }),

  delete: writeMaintenance.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.maintenanceWindow.findUnique({ where: { id: input.id } });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Maintenance window not found' });

    await prisma.maintenanceWindow.delete({ where: { id: input.id } });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'DELETED_MAINTENANCE_WINDOW',
      target: existing.title,
      ipAddress: ctx.ipAddress,
    });

    return { id: input.id };
  }),
});
