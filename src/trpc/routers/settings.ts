import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { getSettings, generateApiKey, generateWebhookSecret } from '@/lib/settings';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import IntegrationAlertEmail from '@/emails/integration-alert-email';
import { monitorIntervalEnum } from '@/trpc/routers/monitor';

export type AppSettingsView = {
  organizationName: string;
  timezone: string;
  supportEmail: string;
  defaultCheckInterval: string;
  httpTimeoutSeconds: number;
  failedAttemptsThreshold: number;
  latencyThresholdMs: number;
  sslCheckEnabled: boolean;
  certExpiryWarningEnabled: boolean;
  certExpiryWarningDays: number;
  checkRetentionDays: number;
  deliveryRetentionDays: number;
  smtpHost: string;
  smtpPort: number | null;
  smtpUser: string;
  smtpPassSet: boolean;
  smtpFromEmail: string;
  smtpFromName: string;
  smtpUseTls: boolean;
  apiKey: string;
  webhookSigningSecret: string;
  updatedAt: string;
};

function serialize(settings: Awaited<ReturnType<typeof getSettings>>): AppSettingsView {
  return {
    organizationName: settings.organizationName,
    timezone: settings.timezone,
    supportEmail: settings.supportEmail ?? '',
    defaultCheckInterval: settings.defaultCheckInterval,
    httpTimeoutSeconds: settings.httpTimeoutSeconds,
    failedAttemptsThreshold: settings.failedAttemptsThreshold,
    latencyThresholdMs: settings.latencyThresholdMs,
    sslCheckEnabled: settings.sslCheckEnabled,
    certExpiryWarningEnabled: settings.certExpiryWarningEnabled,
    certExpiryWarningDays: settings.certExpiryWarningDays,
    checkRetentionDays: settings.checkRetentionDays,
    deliveryRetentionDays: settings.deliveryRetentionDays,
    smtpHost: settings.smtpHost ?? '',
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser ?? '',
    smtpPassSet: !!settings.smtpPass,
    smtpFromEmail: settings.smtpFromEmail ?? '',
    smtpFromName: settings.smtpFromName ?? '',
    smtpUseTls: settings.smtpUseTls,
    apiKey: settings.apiKey,
    webhookSigningSecret: settings.webhookSigningSecret,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export const settingsRouter = createTRPCRouter({
  get: protectedProcedure.query(async () => serialize(await getSettings())),

  updateGeneral: protectedProcedure
    .input(
      z.object({
        organizationName: z.string().trim().min(1, 'Organization name is required').max(200),
        timezone: z.string().trim().min(1),
        supportEmail: z.union([z.string().trim().email(), z.literal('')]).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await getSettings();
      const settings = await prisma.appSettings.update({
        where: { id: 'singleton' },
        data: {
          organizationName: input.organizationName,
          timezone: input.timezone,
          supportEmail: input.supportEmail || null,
        },
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'UPDATED_SETTINGS',
        target: 'General',
        ipAddress: ctx.ipAddress,
      });

      return serialize(settings);
    }),

  updateMonitoring: protectedProcedure
    .input(
      z.object({
        defaultCheckInterval: monitorIntervalEnum,
        httpTimeoutSeconds: z.number().int().min(1).max(300),
        failedAttemptsThreshold: z.number().int().min(1).max(20),
        latencyThresholdMs: z.number().int().min(50).max(60_000),
        sslCheckEnabled: z.boolean(),
        certExpiryWarningEnabled: z.boolean(),
        certExpiryWarningDays: z.number().int().min(1).max(365),
        // Retention, enforced by worker/cmd/janitor. The floor is 1 day
        // rather than 0 because 0 would mean "delete everything, including
        // the check that just ran".
        checkRetentionDays: z.number().int().min(1).max(3650),
        deliveryRetentionDays: z.number().int().min(1).max(3650),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await getSettings();
      const settings = await prisma.appSettings.update({
        where: { id: 'singleton' },
        data: input,
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'UPDATED_SETTINGS',
        target: 'Monitoring Defaults',
        ipAddress: ctx.ipAddress,
      });

      return serialize(settings);
    }),

  updateSmtp: protectedProcedure
    .input(
      z.object({
        smtpHost: z.string().trim().max(255).optional(),
        smtpPort: z.number().int().min(1).max(65535).optional(),
        smtpUser: z.string().trim().max(255).optional(),
        smtpPass: z.string().trim().max(500).optional(), // leave empty to keep the existing secret
        smtpFromEmail: z.union([z.string().trim().email(), z.literal('')]).optional(),
        smtpFromName: z.string().trim().max(120).optional(),
        smtpUseTls: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getSettings();

      const settings = await prisma.appSettings.update({
        where: { id: 'singleton' },
        data: {
          smtpHost: input.smtpHost || null,
          smtpPort: input.smtpPort ?? null,
          smtpUser: input.smtpUser || null,
          smtpPass: input.smtpPass ? input.smtpPass : existing.smtpPass,
          smtpFromEmail: input.smtpFromEmail || null,
          smtpFromName: input.smtpFromName || null,
          smtpUseTls: input.smtpUseTls,
        },
      });

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'UPDATED_SMTP_SETTINGS',
        target: 'SMTP & Email',
        ipAddress: ctx.ipAddress,
      });

      return serialize(settings);
    }),

  /**
   * Sends a real test email to the logged-in user. Note: this goes out
   * through the live SMTP transporter configured via .env (see src/lib/email.ts)
   * — the SMTP tab above persists what you type, but doesn't hot-swap the
   * already-initialized transporter, so this won't reflect unsaved/just-saved
   * changes here without a server restart.
   */
  sendTestEmail: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await sendEmail({
      to: ctx.session.user.email,
      subject: 'Test email from your monitoring dashboard',
      react: IntegrationAlertEmail({
        subject: 'SMTP is working',
        message: 'This is a test email sent from the Settings page to confirm outgoing email works.',
      }),
    });

    if (!result.success) {
      throw new Error('Failed to send test email — check your SMTP configuration in .env');
    }

    return { success: true };
  }),

  regenerateApiKey: protectedProcedure.mutation(async ({ ctx }) => {
    await getSettings();
    const settings = await prisma.appSettings.update({
      where: { id: 'singleton' },
      data: { apiKey: generateApiKey() },
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'REGENERATED_API_KEY',
      target: 'API Key',
      ipAddress: ctx.ipAddress,
    });

    return serialize(settings);
  }),

  regenerateWebhookSecret: protectedProcedure.mutation(async ({ ctx }) => {
    await getSettings();
    const settings = await prisma.appSettings.update({
      where: { id: 'singleton' },
      data: { webhookSigningSecret: generateWebhookSecret() },
    });

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'REGENERATED_WEBHOOK_SECRET',
      target: 'Webhook Signing Secret',
      ipAddress: ctx.ipAddress,
    });

    return serialize(settings);
  }),
});
