import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { createTRPCRouter, protectedProcedure, baseProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  incidentImpactEnum,
  incidentStatusEnum,
  createIncident,
  postIncidentUpdate,
  resolveIncident,
  acknowledgeIncident,
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
  acknowledgedAt: string | null;
  acknowledgedBy: { id: string; name: string } | null;
  escalationStep: number;
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
  postmortem: string | null;
  postmortemPublishedAt: string | null;
};

const summaryInclude = {
  monitor: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  acknowledgedBy: { select: { id: true, name: true } },
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
    acknowledgedAt: incident.acknowledgedAt ? incident.acknowledgedAt.toISOString() : null,
    acknowledgedBy: incident.acknowledgedBy,
    escalationStep: incident.escalationStep,
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
          acknowledgedBy: { select: { id: true, name: true } },
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
        acknowledgedAt: incident.acknowledgedAt ? incident.acknowledgedAt.toISOString() : null,
        acknowledgedBy: incident.acknowledgedBy,
        escalationStep: incident.escalationStep,
        updates: incident.updates.map((update) => ({
          id: update.id,
          status: update.status as IncidentStatus,
          message: update.message,
          author: update.author,
          createdAt: update.createdAt.toISOString(),
        })),
        postmortem: incident.postmortem,
        postmortemPublishedAt: incident.postmortemPublishedAt
          ? incident.postmortemPublishedAt.toISOString()
          : null,
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

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'CREATED_INCIDENT',
        target: incident.title,
        ipAddress: ctx.ipAddress,
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

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'RESOLVED_INCIDENT',
        target: incident.title,
        ipAddress: ctx.ipAddress,
      });

      return { id: incident.id };
    }),

  /**
   * Marks an incident as acknowledged — the halting condition for
   * src/lib/incidents.ts's escalateOverdueIncidents(). No-op (not an error)
   * if it's already acknowledged, so double-clicking is safe.
   */
  acknowledge: protectedProcedure
    .input(z.object({ incidentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const incident = await acknowledgeIncident(input.incidentId, ctx.session.user.id);

      if (!incident) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
      }

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'ACKNOWLEDGED_INCIDENT',
        target: incident.title,
        ipAddress: ctx.ipAddress,
      });

      return { id: incident.id };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.incident.findUnique({ where: { id: input.id } });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });
      }

      await prisma.incident.delete({ where: { id: input.id } });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'DELETED_INCIDENT',
        target: existing.title,
        ipAddress: ctx.ipAddress,
      });

      return { id: input.id };
    }),

  /**
   * Saves the postmortem draft, and optionally publishes it (visible on the
   * public status page — see statusPage.getPublicBySlug). Publishing is a
   * one-way switch here: unpublishing would need to clear
   * postmortemPublishedAt explicitly, which the dashboard UI doesn't expose
   * (a published postmortem can still be edited in place).
   */
  setPostmortem: protectedProcedure
    .input(
      z.object({
        incidentId: z.string(),
        postmortem: z.string().trim().max(10_000),
        publish: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.incident.findUnique({ where: { id: input.incidentId } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });

      const incident = await prisma.incident.update({
        where: { id: input.incidentId },
        data: {
          postmortem: input.postmortem || null,
          postmortemPublishedAt: input.publish ? (existing.postmortemPublishedAt ?? new Date()) : existing.postmortemPublishedAt,
        },
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: input.publish ? 'PUBLISHED_POSTMORTEM' : 'SAVED_POSTMORTEM_DRAFT',
        target: incident.title,
        ipAddress: ctx.ipAddress,
      });

      return {
        id: incident.id,
        postmortem: incident.postmortem,
        postmortemPublishedAt: incident.postmortemPublishedAt ? incident.postmortemPublishedAt.toISOString() : null,
      };
    }),

  // -- Public (unauthenticated) procedures, used by src/app/(status) --------

  /**
   * Self-serve "notify me about this incident" — distinct from
   * statusPage.subscribe (which subscribes to every incident on a whole
   * page). Backed by IncidentSubscriber; every postIncidentUpdate() call
   * emails everyone subscribed here (see src/lib/incidents.ts).
   */
  subscribe: baseProcedure
    .input(z.object({ incidentId: z.string(), email: z.string().trim().email() }))
    .mutation(async ({ input }) => {
      const incident = await prisma.incident.findUnique({ where: { id: input.incidentId } });
      if (!incident) throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found' });

      try {
        await prisma.incidentSubscriber.create({
          data: { incidentId: input.incidentId, email: input.email },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: 'This email is already subscribed' });
        }
        throw error;
      }

      return { success: true };
    }),
});
