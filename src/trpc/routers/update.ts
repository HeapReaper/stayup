import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, capabilityProcedure } from '../init';
import { checkForUpdates, getUpdateStatus, setUpdateCheckEnabled } from '@/lib/updates';
import { logAudit } from '@/lib/audit';

/** Instance-wide settings: Admin only. */
const writeSettings = capabilityProcedure('settings:write');

export type { UpdateStatusView, UpdateChannel } from '@/lib/updates';

/**
 * The update checker's dashboard surface. `status` is a plain DB read — the
 * sidebar polls it on every dashboard page — while `check` is the only
 * procedure here that reaches out to GitLab, and only when someone presses
 * the button.
 */
export const updateRouter = createTRPCRouter({
  status: protectedProcedure.query(async () => getUpdateStatus()),

  check: writeSettings.mutation(async ({ ctx }) => {
    const status = await checkForUpdates();

    await logAudit({
      actorId: ctx.session.user.id,
      actorName: ctx.session.user.name,
      action: 'CHECKED_UPDATES',
      target: status.lastError ? 'Update check failed' : (status.latestVersion ?? 'Updates'),
      ipAddress: ctx.ipAddress,
    });

    return status;
  }),

  setAutoCheck: writeSettings
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const status = await setUpdateCheckEnabled(input.enabled);

      await logAudit({
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        action: 'UPDATED_SETTINGS',
        target: input.enabled ? 'Automatic update checks on' : 'Automatic update checks off',
        ipAddress: ctx.ipAddress,
      });

      return status;
    }),
});
