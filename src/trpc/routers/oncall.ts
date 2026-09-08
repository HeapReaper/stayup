// On-call schedules: a rotation of people, each reachable through one
// Integration, taking the pager in turn. Attach one to an EscalationStep
// (escalationPolicy.ts) and that rung pages whoever the rotation says is up
// at the moment it fires, instead of a fixed channel.
//
// The rotation itself is never precomputed — resolveOnCallAt() in
// src/lib/oncall.ts derives it from the schedule's anchor on every lookup, so
// reordering the roster or fixing the handoff hour takes effect immediately.
// The Go mirror in worker/internal/oncall is what actually pages.
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import { createTRPCRouter, protectedProcedure, capabilityProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { resolveOnCallAt, shiftEndAt, type OnCallScheduleRef } from '@/lib/oncall';

/** On-call changes ride along with escalation policies: Admin and Member. */
const writeOnCall = capabilityProcedure('escalations:write');

export const rotationTypeEnum = z.enum(['Daily', 'Weekly']);

export type OnCallParticipantItem = {
  id: string;
  name: string;
  order: number;
  integrationId: string;
  integrationName: string;
  userId: string | null;
};

export type OnCallOverrideItem = {
  id: string;
  startsAt: string;
  endsAt: string;
  participantId: string | null;
  participantName: string | null;
  reason: string | null;
};

export type OnCallScheduleSummary = {
  id: string;
  name: string;
  timezone: string;
  rotationType: string;
  handoffHour: number;
  handoffDay: number;
  startsAt: string;
  participantCount: number;
  /** Who holds the pager right now, resolved the same way the worker does. */
  currentName: string | null;
  currentOverridden: boolean;
  currentReason: string | null;
  shiftEndsAt: string | null;
};

export type OnCallScheduleDetail = OnCallScheduleSummary & {
  participants: OnCallParticipantItem[];
  overrides: OnCallOverrideItem[];
};

const withRelations = {
  participants: { orderBy: { order: 'asc' }, include: { integration: { select: { name: true } } } },
  overrides: { orderBy: { startsAt: 'asc' }, include: { participant: { select: { name: true } } } },
} satisfies Prisma.OnCallScheduleInclude;

type RawSchedule = Prisma.OnCallScheduleGetPayload<{ include: typeof withRelations }>;

/** The shape src/lib/oncall.ts resolves against. */
function toRef(schedule: RawSchedule): OnCallScheduleRef {
  return {
    timezone: schedule.timezone,
    rotationType: schedule.rotationType,
    handoffHour: schedule.handoffHour,
    handoffDay: schedule.handoffDay,
    startsAt: schedule.startsAt,
    participants: schedule.participants.map((p) => ({
      id: p.id,
      name: p.name,
      order: p.order,
      integrationId: p.integrationId,
    })),
    overrides: schedule.overrides.map((o) => ({
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      participantId: o.participantId,
      reason: o.reason,
    })),
  };
}

function serializeSummary(schedule: RawSchedule, now = new Date()): OnCallScheduleSummary {
  const ref = toRef(schedule);
  const resolution = resolveOnCallAt(ref, now);

  return {
    id: schedule.id,
    name: schedule.name,
    timezone: schedule.timezone,
    rotationType: schedule.rotationType,
    handoffHour: schedule.handoffHour,
    handoffDay: schedule.handoffDay,
    startsAt: schedule.startsAt.toISOString(),
    participantCount: schedule.participants.length,
    currentName: resolution.participant?.name ?? null,
    currentOverridden: resolution.overridden,
    currentReason: resolution.reason,
    // Meaningless with nobody on the roster, and misleading if shown anyway.
    shiftEndsAt: schedule.participants.length > 0 ? shiftEndAt(ref, now).toISOString() : null,
  };
}

function serializeDetail(schedule: RawSchedule): OnCallScheduleDetail {
  return {
    ...serializeSummary(schedule),
    participants: schedule.participants.map((p) => ({
      id: p.id,
      name: p.name,
      order: p.order,
      integrationId: p.integrationId,
      integrationName: p.integration.name,
      userId: p.userId,
    })),
    overrides: schedule.overrides.map((o) => ({
      id: o.id,
      startsAt: o.startsAt.toISOString(),
      endsAt: o.endsAt.toISOString(),
      participantId: o.participantId,
      participantName: o.participant?.name ?? null,
      reason: o.reason,
    })),
  };
}

const participantInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  integrationId: z.string().min(1, 'Pick how this person is paged'),
  userId: z.string().nullable().optional(),
});

const scheduleInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  // Free text rather than an enum: the IANA database has hundreds of zones
  // and both resolvers fall back to UTC for one they don't know.
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  rotationType: rotationTypeEnum.default('Weekly'),
  handoffHour: z.coerce.number().int().min(0).max(23).default(9),
  handoffDay: z.coerce.number().int().min(1).max(7).default(1),
  startsAt: z.coerce.date().optional(),
  participants: z.array(participantInput).min(1, 'Add at least one person'),
});

/** Replaces a schedule's roster from the editor's ordered array. */
async function applyParticipants(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  participants: z.infer<typeof participantInput>[],
) {
  // Overrides cascade off participants, so a full replace would silently drop
  // "I'm ill next week" every time the roster is saved. Match the existing
  // rows by position instead, and only delete the ones that really went.
  const existing = await tx.onCallParticipant.findMany({
    where: { scheduleId },
    orderBy: { order: 'asc' },
  });

  for (const [index, participant] of participants.entries()) {
    const current = existing[index];
    if (current) {
      await tx.onCallParticipant.update({
        where: { id: current.id },
        data: {
          order: index,
          name: participant.name,
          integrationId: participant.integrationId,
          userId: participant.userId || null,
        },
      });
      continue;
    }
    await tx.onCallParticipant.create({
      data: {
        scheduleId,
        order: index,
        name: participant.name,
        integrationId: participant.integrationId,
        userId: participant.userId || null,
      },
    });
  }

  const removed = existing.slice(participants.length);
  if (removed.length > 0) {
    await tx.onCallParticipant.deleteMany({ where: { id: { in: removed.map((p) => p.id) } } });
  }
}

export const onCallRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => {
    const schedules = await prisma.onCallSchedule.findMany({
      orderBy: { createdAt: 'desc' },
      include: withRelations,
    });
    return schedules.map((schedule) => serializeSummary(schedule));
  }),

  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const schedule = await prisma.onCallSchedule.findUnique({
      where: { id: input.id },
      include: withRelations,
    });
    if (!schedule) throw new TRPCError({ code: 'NOT_FOUND', message: 'On-call schedule not found' });
    return serializeDetail(schedule);
  }),

  create: writeOnCall.input(scheduleInput).mutation(async ({ input, ctx }) => {
    const schedule = await prisma.$transaction(async (tx) => {
      const created = await tx.onCallSchedule.create({
        data: {
          name: input.name,
          timezone: input.timezone,
          rotationType: input.rotationType,
          handoffHour: input.handoffHour,
          handoffDay: input.handoffDay,
          startsAt: input.startsAt ?? new Date(),
          createdById: ctx.session.user.id,
        },
      });
      await applyParticipants(tx, created.id, input.participants);
      return created;
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'CREATED_ONCALL_SCHEDULE',
      target: schedule.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: schedule.id };
  }),

  update: writeOnCall.input(scheduleInput.extend({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.onCallSchedule.findUnique({ where: { id: input.id } });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'On-call schedule not found' });

    const schedule = await prisma.$transaction(async (tx) => {
      const updated = await tx.onCallSchedule.update({
        where: { id: input.id },
        data: {
          name: input.name,
          timezone: input.timezone,
          rotationType: input.rotationType,
          handoffHour: input.handoffHour,
          handoffDay: input.handoffDay,
          // Deliberately not resettable from the editor: moving the anchor
          // reshuffles who is on call right now, which is not what "save" is
          // expected to do.
          ...(input.startsAt ? { startsAt: input.startsAt } : {}),
        },
      });
      await applyParticipants(tx, input.id, input.participants);
      return updated;
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'UPDATED_ONCALL_SCHEDULE',
      target: schedule.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: schedule.id };
  }),

  delete: writeOnCall.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.onCallSchedule.findUnique({ where: { id: input.id } });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'On-call schedule not found' });

    // Escalation steps pointing at this schedule cascade away with it, which
    // would silently shorten a paging chain — refuse instead and let whoever
    // is deleting it decide what those steps should do.
    const steps = await prisma.escalationStep.count({ where: { onCallScheduleId: input.id } });
    if (steps > 0) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `This schedule is used by ${steps} escalation step(s) — remove them first`,
      });
    }

    await prisma.onCallSchedule.delete({ where: { id: input.id } });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'DELETED_ONCALL_SCHEDULE',
      target: existing.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: input.id };
  }),

  /** "I'm ill this week" — a window where the rotation's answer is replaced. */
  addOverride: writeOnCall
    .input(
      z
        .object({
          scheduleId: z.string(),
          startsAt: z.coerce.date(),
          endsAt: z.coerce.date(),
          // null is meaningful: nobody covers the window, so paging falls
          // through to the next escalation step.
          participantId: z.string().nullable().optional(),
          reason: z.string().trim().max(200).optional(),
        })
        .refine((input) => input.endsAt > input.startsAt, {
          message: 'The override has to end after it starts',
          path: ['endsAt'],
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const schedule = await prisma.onCallSchedule.findUnique({ where: { id: input.scheduleId } });
      if (!schedule) throw new TRPCError({ code: 'NOT_FOUND', message: 'On-call schedule not found' });

      const override = await prisma.onCallOverride.create({
        data: {
          scheduleId: input.scheduleId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          participantId: input.participantId || null,
          reason: input.reason || null,
        },
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'CREATED_ONCALL_OVERRIDE',
        target: schedule.name,
        ipAddress: ctx.ipAddress,
      });

      return { id: override.id };
    }),

  removeOverride: writeOnCall.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.onCallOverride.findUnique({
      where: { id: input.id },
      include: { schedule: { select: { name: true } } },
    });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Override not found' });

    await prisma.onCallOverride.delete({ where: { id: input.id } });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'DELETED_ONCALL_OVERRIDE',
      target: existing.schedule.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: input.id };
  }),
});
