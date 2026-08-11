import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logging';

interface LogAuditInput {
  actorId?: string | null;
  actorName: string;
  action: string;
  target: string;
  ipAddress?: string | null;
}

/**
 * Records a significant dashboard action for the Logs page's Audit Logs tab.
 * Never throws — a failure to write the audit trail shouldn't break the
 * action it's describing.
 */
export async function logAudit(input: LogAuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorName: input.actorName,
        action: input.action,
        target: input.target,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (error) {
    logger.error('[Audit] Failed to write audit log entry', error);
  }
}
