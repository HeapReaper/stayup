import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';

export function generateApiKey() {
  return `up_live_${crypto.randomBytes(16).toString('hex')}`;
}

export function generateWebhookSecret() {
  return `whsec_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Fetches the single instance-wide settings row, creating it (with freshly
 * generated API key / webhook secret) on first use. There is exactly one row
 * — id is always "singleton" — this isn't a multi-tenant app.
 */
export async function getSettings() {
  const existing = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  if (existing) return existing;

  try {
    return await prisma.appSettings.create({
      data: {
        id: 'singleton',
        apiKey: generateApiKey(),
        webhookSigningSecret: generateWebhookSecret(),
      },
    });
  } catch {
    // Lost a race to create the singleton row — read back whichever request won.
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    if (settings) return settings;
    throw new Error('Failed to load or create app settings');
  }
}
