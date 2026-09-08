import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, capabilityProcedure } from '../init';
import { prisma } from '@/lib/prisma';
import { getSettings, generateApiKey, generateWebhookSecret } from '@/lib/settings';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import IntegrationAlertEmail from '@/emails/integration-alert-email';
import { monitorIntervalEnum } from '@/trpc/routers/monitor';

/** Instance-wide settings: Admin only. */
const writeSettings = capabilityProcedure('settings:write');

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
  domainExpiryWarningEnabled: boolean;
  domainExpiryWarningDays: number;
  flappingEnabled: boolean;
  flappingWindowMinutes: number;
  flappingThreshold: number;
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
    domainExpiryWarningEnabled: settings.domainExpiryWarningEnabled,
    domainExpiryWarningDays: settings.domainExpiryWarningDays,
    flappingEnabled: settings.flappingEnabled,
    flappingWindowMinutes: settings.flappingWindowMinutes,
    flappingThreshold: settings.flappingThreshold,
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

  updateGeneral: writeSettings
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

  updateMonitoring: writeSettings
    .input(
      z.object({
        defaultCheckInterval: monitorIntervalEnum,
        httpTimeoutSeconds: z.number().int().min(1).max(300),
        failedAttemptsThreshold: z.number().int().min(1).max(20),
        latencyThresholdMs: z.number().int().min(50).max(60_000),
        sslCheckEnabled: z.boolean(),
        certExpiryWarningEnabled: z.boolean(),
        certExpiryWarningDays: z.number().int().min(1).max(365),
        domainExpiryWarningEnabled: z.boolean(),
        domainExpiryWarningDays: z.number().int().min(1).max(365),
        // Flapping detection (worker/internal/flapping). The threshold floor
        // is 2 because one transition is not an oscillation, and the window
        // floor is 1 minute because a zero window would mark everything.
        flappingEnabled: z.boolean(),
        flappingWindowMinutes: z.number().int().min(1).max(1440),
        flappingThreshold: z.number().int().min(2).max(100),
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

  updateSmtp: writeSettings
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
   * Sends a real test email to the logged-in user, through whatever the SMTP
   * tab above has saved (falling back per field to the SMTP_* environment —
   * see resolveSmtpConfig() in src/lib/email.ts). The transporter is keyed on
   * that resolved config, so a Save here is picked up by the very next send:
   * save first, then test.
   */
  sendTestEmail: writeSettings.mutation(async ({ ctx }) => {
    const result = await sendEmail({
      to: ctx.session.user.email,
      subject: 'Test email from your monitoring dashboard',
      react: IntegrationAlertEmail({
        subject: 'SMTP is working',
        message: 'This is a test email sent from the Settings page to confirm outgoing email works.',
      }),
    });

    if (!result.success) {
      // The SMTP server's own rejection is the only thing that actually tells
      // an admin what to change, so pass it through instead of a generic
      // "check your configuration".
      throw new Error(`Failed to send test email: ${result.error ?? 'unknown error'}`);
    }

    return { success: true };
  }),

  regenerateApiKey: writeSettings.mutation(async ({ ctx }) => {
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

  regenerateWebhookSecret: writeSettings.mutation(async ({ ctx }) => {
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
