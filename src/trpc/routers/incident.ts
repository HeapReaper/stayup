import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import { createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import {
  incidentImpactEnum,
  incidentStatusEnum,
  createIncident,
  postIncidentUpdate,
  resolveIncident,
  type IncidentImpact,
  type IncidentStatus,
} from '@/lib/incidents';

export { incidentImpactEnum, incidentStatusEnum };
export type { IncidentImpact, IncidentStatus };

export type IncidentSummary = {
  id: string;
  title: string;
  impact: IncidentImpact;
  status: IncidentStatus;
  monitor: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestUpdate: { message: string; status: IncidentStatus; createdAt: string } | null;
};

export type IncidentUpdateItem = {
  id: string;
  status: IncidentStatus;
  message: string;
  author: { id: string; name: string } | null;
  createdAt: string;
};

export type IncidentDetail = IncidentSummary & {
  updates: IncidentUpdateItem[];
};

const summaryInclude = {
  monitor: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  updates: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.IncidentInclude;

type RawSummary = Prisma.IncidentGetPayload<{ include: typeof summaryInclude }>;

function serializeSummary(incident: RawSummary): IncidentSummary {
  const latest = incident.updates[0];

  return {
    id: incident.id,
    title: incident.title,
    impact: incident.impact as IncidentImpact,
    status: incident.status as IncidentStatus,
    monitor: incident.monitor,
    createdBy: incident.createdBy,
    resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
    latestUpdate: latest
      ? {
          message: latest.message,
          status: latest.status as IncidentStatus,
          createdAt: latest.createdAt.toISOString(),
        }
      : null,
  };
}

export const incidentRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => {
    const incidents = await prisma.incident.findMany({
      include: summaryInclude,
      orderBy: { createdAt: 'desc' },
    });

    return incidents.map(serializeSummary);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }): Promise<IncidentDetail> => {
      const incident = await prisma.incident.findUnique({
        where: { id: input.id },
        include: {
          monitor: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          updates: {
            orderBy: { createdAt: 'asc' },
            include: { author: { select: { id: true, name: true } } },
          },
        },
      });

      if (!incident) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
      }

      return {
        id: incident.id,
        title: incident.title,
        impact: incident.impact as IncidentImpact,
        status: incident.status as IncidentStatus,
        monitor: incident.monitor,
        createdBy: incident.createdBy,
        resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
        createdAt: incident.createdAt.toISOString(),
        updatedAt: incident.updatedAt.toISOString(),
        latestUpdate: null,
        updates: incident.updates.map((update) => ({
          id: update.id,
          status: update.status as IncidentStatus,
          message: update.message,
          author: update.author,
          createdAt: update.createdAt.toISOString(),
        })),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1, 'Title is required').max(200),
        monitorId: z.string().optional(),
        impact: incidentImpactEnum,
        message: z.string().trim().min(1, 'Please describe what is going on').max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const incident = await createIncident({
        title: input.title,
        impact: input.impact,
        message: input.message,
        monitorId: input.monitorId,
        createdById: ctx.session.user.id,
      });

      return { id: incident.id };
    }),

  addUpdate: protectedProcedure
    .input(
      z.object({
        incidentId: z.string(),
        status: incidentStatusEnum,
        message: z.string().trim().min(1, 'Update message is required').max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.incident.findUnique({ where: { id: input.incidentId } });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
      }

      const incident = await postIncidentUpdate({
        incidentId: input.incidentId,
        status: input.status,
        message: input.message,
        authorId: ctx.session.user.id,
      });

      return { id: incident.id };
    }),

  resolve: protectedProcedure
    .input(
      z.object({
        incidentId: z.string(),
        message: z.string().trim().max(2000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.incident.findUnique({ where: { id: input.incidentId } });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
      }

      const incident = await resolveIncident(
        input.incidentId,
        input.message?.trim() || 'This incident has been resolved.',
        ctx.session.user.id,
      );

      return { id: incident.id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const existing = await prisma.incident.findUnique({ where: { id: input.id } });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
      }

      await prisma.incident.delete({ where: { id: input.id } });

      return { id: input.id };
    }),
});
