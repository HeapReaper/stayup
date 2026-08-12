import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import { createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { deliverToIntegration } from '@/lib/integration-delivery';
import { getSettings } from '@/lib/settings';

export const integrationTypeEnum = z.enum(['Discord', 'Slack', 'Webhook', 'Telegram', 'Email', 'PagerDuty', 'Push']);
export type IntegrationType = z.infer<typeof integrationTypeEnum>;

export type IntegrationSummary = {
  id: string;
  name: string;
  type: IntegrationType;
  target: string;
  enabled: boolean;
  hasSecret: boolean;
  lastDelivery: { status: string; createdAt: string } | null;
  createdAt: string;
};

const integrationInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  type: integrationTypeEnum,
  target: z.string().trim().min(1, 'Target is required').max(2000),
  secret: z.string().trim().max(500).optional(),
  enabled: z.boolean(),
});

const withLastDelivery = {
  deliveries: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.IntegrationInclude;

type RawIntegration = Prisma.IntegrationGetPayload<{ include: typeof withLastDelivery }>;

function serialize(integration: RawIntegration): IntegrationSummary {
  const last = integration.deliveries[0];

  return {
    id: integration.id,
    name: integration.name,
    type: integration.type as IntegrationType,
    target: integration.target,
    enabled: integration.enabled,
    hasSecret: !!integration.secret,
    lastDelivery: last ? { status: last.status, createdAt: last.createdAt.toISOString() } : null,
    createdAt: integration.createdAt.toISOString(),
  };
}

export const integrationRouter = createTRPCRouter({
  getAll: protectedProcedure.query(async () => {
    const integrations = await prisma.integration.findMany({
      orderBy: { createdAt: 'desc' },
      include: withLastDelivery,
    });

    return integrations.map(serialize);
  }),

  create: protectedProcedure.input(integrationInput).mutation(async ({ input, ctx }) => {
    const integration = await prisma.integration.create({
      data: {
        name: input.name,
        type: input.type,
        target: input.target,
        secret: input.type === 'Telegram' ? input.secret || null : null,
        enabled: input.enabled,
        createdById: ctx.session.user.id,
      },
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'CREATED_INTEGRATION',
      target: integration.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: integration.id };
  }),

  update: protectedProcedure.input(integrationInput.extend({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.integration.findUnique({ where: { id: input.id } });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration not found' });

    const integration = await prisma.integration.update({
      where: { id: input.id },
      data: {
        name: input.name,
        type: input.type,
        target: input.target,
        // Keep the existing secret unless a new one was actually typed.
        secret: input.type === 'Telegram' ? input.secret || existing.secret : null,
        enabled: input.enabled,
      },
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'UPDATED_INTEGRATION',
      target: integration.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: integration.id };
  }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const existing = await prisma.integration.findUnique({ where: { id: input.id } });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration not found' });

    await prisma.integration.delete({ where: { id: input.id } });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'DELETED_INTEGRATION',
      target: existing.name,
      ipAddress: ctx.ipAddress,
    });

    return { id: input.id };
  }),

  toggleEnabled: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const integration = await prisma.integration.update({
        where: { id: input.id },
        data: { enabled: input.enabled },
      });

      return { id: integration.id, enabled: integration.enabled };
    }),

  /** Delivers a test notification immediately (not queued) so the user gets instant feedback. */
  testSend: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const integration = await prisma.integration.findUnique({ where: { id: input.id } });
    if (!integration) throw new TRPCError({ code: 'NOT_FOUND', message: 'Integration not found' });

    const result = await deliverToIntegration(
      integration,
      'Test Notification',
      `This is a test notification from your monitoring dashboard's "${integration.name}" integration.`,
    );

    await prisma.integrationDelivery.create({
      data: {
        integrationId: integration.id,
        event: 'Test Notification',
        message: 'Manual test notification',
        status: result.success ? 'Sent' : 'Failed',
        attempts: 1,
        error: result.error,
        sentAt: result.success ? new Date() : null,
      },
    });

    if (!result.success) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: result.error ?? 'Delivery failed' });
    }

    return { success: true };
  }),

  /** Public VAPID key, needed client-side to open a browser PushSubscription (see registerPush below). */
  getVapidPublicKey: protectedProcedure.query(async () => {
    const settings = await getSettings();
    return { publicKey: settings.vapidPublicKey };
  }),

  /**
   * Turns a browser's PushSubscription into a "Push" Integration, so it
   * receives incident alerts the same way a Discord/Slack channel would.
   * Called by integrations-client.tsx's "Enable browser push" button after
   * it completes the PushManager.subscribe() handshake — the subscription
   * itself (endpoint + keys) is what gets stored as the target.
   */
  registerPush: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        subscription: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        JSON.parse(input.subscription);
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid push subscription' });
      }

      // Re-subscribing the same browser (e.g. after clearing site data) reuses
      // its existing row instead of piling up dead duplicates.
      const existing = await prisma.integration.findFirst({
        where: { type: 'Push', target: input.subscription },
      });
      if (existing) return { id: existing.id };

      const integration = await prisma.integration.create({
        data: {
          name: input.name,
          type: 'Push',
          target: input.subscription,
          enabled: true,
          createdById: ctx.session.user.id,
        },
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'CREATED_INTEGRATION',
        target: integration.name,
        ipAddress: ctx.ipAddress,
      });

      return { id: integration.id };
    }),
});
