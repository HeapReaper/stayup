// Notification rules: where an incident's alert goes when its monitor has no
// escalation policy. Without any rules the behaviour is what it always was —
// broadcast to every enabled Integration — so this is purely additive.
//
// The evaluation itself lives in src/lib/notification-rules.ts (and its Go
// mirror worker/internal/routing); this router only stores and orders them.
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import { createTRPCRouter, protectedProcedure, capabilityProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { incidentImpactEnum } from '@/lib/incidents';

/** Routing decides who gets paged, so it rides with integrations: Admin and Member. */
const writeRules = capabilityProcedure('integrations:write');

export const notificationRuleActionEnum = z.enum(['Route', 'Suppress']);

export type NotificationRuleItem = {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  action: string;
  matchTagId: string | null;
  matchTagName: string | null;
  matchMonitorId: string | null;
  matchMonitorName: string | null;
  matchImpact: string | null;
  activeDays: string | null;
  activeFromMinute: number | null;
  activeUntilMinute: number | null;
  integrationIds: string[];
  integrationNames: string[];
};

const withRelations = {
  matchTag: { select: { name: true } },
  matchMonitor: { select: { name: true } },
  integrations: { include: { integration: { select: { id: true, name: true } } } },
} satisfies Prisma.NotificationRuleInclude;

type RawRule = Prisma.NotificationRuleGetPayload<{ include: typeof withRelations }>;

function serialize(rule: RawRule): NotificationRuleItem {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    order: rule.order,
    action: rule.action,
    matchTagId: rule.matchTagId,
    matchTagName: rule.matchTag?.name ?? null,
    matchMonitorId: rule.matchMonitorId,
    matchMonitorName: rule.matchMonitor?.name ?? null,
    matchImpact: rule.matchImpact,
    activeDays: rule.activeDays,
    activeFromMinute: rule.activeFromMinute,
    activeUntilMinute: rule.activeUntilMinute,
    integrationIds: rule.integrations.map((link) => link.integration.id),
    integrationNames: rule.integrations.map((link) => link.integration.name),
  };
}

// "1,2,3,4,5" — ISO weekdays, Monday first. Stored as text because it is only
// ever read back whole, by both the TypeScript and the Go evaluator.
const ACTIVE_DAYS = /^[1-7](,[1-7])*$/;

const ruleInput = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    enabled: z.boolean().default(true),
    action: notificationRuleActionEnum.default('Route'),
    matchTagId: z.string().nullable().optional(),
    matchMonitorId: z.string().nullable().optional(),
    matchImpact: incidentImpactEnum.nullable().optional(),
    activeDays: z
      .string()
      .trim()
      .nullable()
      .optional()
      .refine((value) => !value || ACTIVE_DAYS.test(value), {
        message: 'Use ISO weekday numbers, e.g. "1,2,3,4,5" for Monday to Friday',
      }),
    activeFromMinute: z.coerce.number().int().min(0).max(1439).nullable().optional(),
    activeUntilMinute: z.coerce.number().int().min(0).max(1440).nullable().optional(),
    integrationIds: z.array(z.string()).default([]),
  })
  // Both bounds or neither: one alone has no meaning to either evaluator.
  .refine(
    (rule) =>
      (rule.activeFromMinute === null || rule.activeFromMinute === undefined) ===
      (rule.activeUntilMinute === null || rule.activeUntilMinute === undefined),
    { message: 'Give both a start and an end time, or neither', path: ['activeUntilMinute'] },
  )
  // A Route rule that routes nowhere silently drops every alert it matches,
  // which is a Suppress rule written by accident.
  .refine((rule) => rule.action !== 'Route' || rule.integrationIds.length > 0, {
    message: 'A routing rule needs at least one integration — use Suppress to deliberately notify nobody',
    path: ['integrationIds'],
  });

async function applyIntegrations(tx: Prisma.TransactionClient, ruleId: string, integrationIds: string[]) {
  await tx.notificationRuleIntegration.deleteMany({ where: { ruleId } });
  if (integrationIds.length === 0) return;

  await tx.notificationRuleIntegration.createMany({
    data: [...new Set(integrationIds)].map((integrationId) => ({ ruleId, integrationId })),
  });
}

/** Rules that carry no window are stored with all three columns null. */
function windowFor(input: z.infer<typeof ruleInput>) {
  return {
    activeDays: input.activeDays || null,
    activeFromMinute: input.activeFromMinute ?? null,
    activeUntilMinute: input.activeUntilMinute ?? null,
  };
}

export const notificationRuleRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => {
    const rules = await prisma.notificationRule.findMany({
      orderBy: { order: 'asc' },
      include: withRelations,
    });
    return rules.map(serialize);
  }),

  create: writeRules.input(ruleInput).mutation(async ({ input, ctx }) => {
    const rule = await prisma.$transaction(async (tx) => {
      // New rules land at the bottom of the chain, where they can't silently
      // shadow an existing one.
      const last = await tx.notificationRule.findFirst({ orderBy: { order: 'desc' }, select: { order: true } });

      const created = await tx.notificationRule.create({
        data: {
          name: input.name,
          enabled: input.enabled,
          action: input.action,
          order: (last?.order ?? -1) + 1,
          matchTagId: input.matchTagId || null,
          matchMonitorId: input.matchMonitorId || null,
          matchImpact: input.matchImpact || null,
          ...windowFor(input),
          createdById: ctx.session.user.id,
        },
      });
      await applyIntegrations(tx, created.id, input.integrationIds);
      return created;
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'CREATED_NOTIFICATION_RULE',
      target: rule.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: rule.id };
  }),

  update: writeRules.input(ruleInput.extend({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.notificationRule.findUnique({ where: { id: input.id } });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Notification rule not found' });

    const rule = await prisma.$transaction(async (tx) => {
      const updated = await tx.notificationRule.update({
        where: { id: input.id },
        data: {
          name: input.name,
          enabled: input.enabled,
          action: input.action,
          matchTagId: input.matchTagId || null,
          matchMonitorId: input.matchMonitorId || null,
          matchImpact: input.matchImpact || null,
          ...windowFor(input),
        },
      });
      await applyIntegrations(tx, input.id, input.integrationIds);
      return updated;
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'UPDATED_NOTIFICATION_RULE',
      target: rule.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: rule.id };
  }),

  /**
   * Moves one rule up or down the chain. Order is the whole semantics —
   * the first applicable rule wins — so it gets its own mutation rather than
   * being an editable number on the form.
   */
  reorder: writeRules
    .input(z.object({ id: z.string(), direction: z.enum(['up', 'down']) }))
    .mutation(async ({ input }) => {
      const rules = await prisma.notificationRule.findMany({ orderBy: { order: 'asc' }, select: { id: true } });
      const index = rules.findIndex((rule) => rule.id === input.id);
      if (index === -1) throw new TRPCError({ code: 'NOT_FOUND', message: 'Notification rule not found' });

      const target = input.direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= rules.length) return { id: input.id };

      const reordered = [...rules];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

      // Rewrite every row's order rather than swapping two: `order` has no
      // unique constraint, and a full rewrite can't leave a gap or a tie.
      await prisma.$transaction(
        reordered.map((rule, order) => prisma.notificationRule.update({ where: { id: rule.id }, data: { order } })),
      );

      return { id: input.id };
    }),

  delete: writeRules.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.notificationRule.findUnique({ where: { id: input.id } });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Notification rule not found' });

    await prisma.notificationRule.delete({ where: { id: input.id } });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'DELETED_NOTIFICATION_RULE',
      target: existing.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: input.id };
  }),
});
