// Escalation policies: a named, ordered paging chain (see EscalationPolicy /
// EscalationStep in the Prisma schema). Attach one to a Monitor
// (monitor.escalationPolicyId — see monitor.ts) to replace the default
// "broadcast to every enabled Integration" behavior for that monitor's
// incidents with "page step 1, and if nobody acknowledges within step N's
// delayMinutes, page step N+1". Actual paging happens in the Go
// integrations worker (worker/internal/incidents's EscalateOverdueIncidents,
// polled from worker/cmd/integrations) — a Go port of what used to be
// src/lib/incidents.ts's escalateOverdueIncidents()/src/workers/integrations.ts.
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import { createTRPCRouter, protectedProcedure, capabilityProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

/** Escalation policy changes: Admin and Member. */
const writeEscalations = capabilityProcedure('escalations:write');

export type EscalationPolicySummary = {
  id: string;
  name: string;
  stepCount: number;
  monitorCount: number;
  createdAt: string;
};

export type EscalationStepItem = {
  id: string;
  delayMinutes: number;
  /** Exactly one of these two is set — see EscalationStep in the Prisma schema. */
  integrationId: string | null;
  onCallScheduleId: string | null;
  /** Name of whichever target the step points at, for the editor's summary line. */
  targetName: string;
};

export type EscalationPolicyDetail = {
  id: string;
  name: string;
  steps: EscalationStepItem[];
};

// A step pages either a fixed Integration or whoever an OnCallSchedule says
// is up at the moment it fires. The schema can't express that XOR on either
// provider, so it's enforced here — the one place every write goes through.
const stepInput = z
  .object({
    delayMinutes: z.coerce.number().int().min(0, 'Delay cannot be negative').max(1440, 'Max 24 hours'),
    integrationId: z.string().nullable().optional(),
    onCallScheduleId: z.string().nullable().optional(),
  })
  .refine((step) => !!step.integrationId !== !!step.onCallScheduleId, {
    message: 'Pick either an integration or an on-call schedule for this step',
    path: ['integrationId'],
  });

const escalationPolicyInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  steps: z.array(stepInput).min(1, 'Add at least one step'),
});

const withCounts = {
  _count: { select: { steps: true, monitors: true } },
} satisfies Prisma.EscalationPolicyInclude;

type RawSummary = Prisma.EscalationPolicyGetPayload<{ include: typeof withCounts }>;

function serializeSummary(policy: RawSummary): EscalationPolicySummary {
  return {
    id: policy.id,
    name: policy.name,
    stepCount: policy._count.steps,
    monitorCount: policy._count.monitors,
    createdAt: policy.createdAt.toISOString(),
  };
}

/** Replaces a policy's steps from the editor's flat, ordered input array. */
async function applySteps(
  tx: Prisma.TransactionClient,
  escalationPolicyId: string,
  steps: z.infer<typeof stepInput>[],
) {
  await tx.escalationStep.deleteMany({ where: { escalationPolicyId } });

  await tx.escalationStep.createMany({
    data: steps.map((step, index) => ({
      escalationPolicyId,
      order: index,
      delayMinutes: step.delayMinutes,
      integrationId: step.integrationId || null,
      onCallScheduleId: step.onCallScheduleId || null,
    })),
  });
}

export const escalationPolicyRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => {
    const policies = await prisma.escalationPolicy.findMany({
      orderBy: { createdAt: 'desc' },
      include: withCounts,
    });

    return policies.map(serializeSummary);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }): Promise<EscalationPolicyDetail> => {
      const policy = await prisma.escalationPolicy.findUnique({
        where: { id: input.id },
        include: {
          steps: {
            orderBy: { order: 'asc' },
            include: {
              integration: { select: { name: true } },
              onCallSchedule: { select: { name: true } },
            },
          },
        },
      });

      if (!policy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Escalation policy not found' });
      }

      return {
        id: policy.id,
        name: policy.name,
        steps: policy.steps.map((step) => ({
          id: step.id,
          delayMinutes: step.delayMinutes,
          integrationId: step.integrationId,
          onCallScheduleId: step.onCallScheduleId,
          targetName:
            step.integration?.name ??
            (step.onCallSchedule ? `On call: ${step.onCallSchedule.name}` : 'Unknown target'),
        })),
      };
    }),

  create: writeEscalations.input(escalationPolicyInput).mutation(async ({ input, ctx }) => {
    const policy = await prisma.$transaction(async (tx) => {
      const created = await tx.escalationPolicy.create({
        data: { name: input.name, createdById: ctx.session.user.id },
      });

      await applySteps(tx, created.id, input.steps);

      return created;
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'CREATED_ESCALATION_POLICY',
      target: policy.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: policy.id };
  }),

  update: writeEscalations
    .input(escalationPolicyInput.extend({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.escalationPolicy.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Escalation policy not found' });

      const policy = await prisma.$transaction(async (tx) => {
        const updated = await tx.escalationPolicy.update({
          where: { id: input.id },
          data: { name: input.name },
        });

        await applySteps(tx, input.id, input.steps);

        return updated;
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'UPDATED_ESCALATION_POLICY',
        target: policy.name,
        ipAddress: ctx.ipAddress,
      });

      return { id: policy.id };
    }),

  delete: writeEscalations.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.escalationPolicy.findUnique({ where: { id: input.id } });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Escalation policy not found' });

    // Monitors referencing this policy fall back to the default broadcast
    // behavior automatically — Monitor.escalationPolicyId is onDelete: SetNull.
    await prisma.escalationPolicy.delete({ where: { id: input.id } });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'DELETED_ESCALATION_POLICY',
      target: existing.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: input.id };
  }),
});
