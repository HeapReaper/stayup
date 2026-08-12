import crypto from 'node:crypto';
import webpush from 'web-push';
import { prisma } from '@/lib/prisma';

export function generateApiKey() {
  return `up_live_${crypto.randomBytes(16).toString('hex')}`;
}

export function generateWebhookSecret() {
  return `whsec_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Fetches the single instance-wide settings row, creating it (with freshly
 * generated API key / webhook secret / VAPID key pair) on first use. There
 * is exactly one row — id is always "singleton" — this isn't a
 * multi-tenant app.
 */
export async function getSettings() {
  const existing = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  if (existing) return backfillVapidKeys(existing);

  try {
    const vapidKeys = webpush.generateVAPIDKeys();
    return await prisma.appSettings.create({
      data: {
        id: 'singleton',
        apiKey: generateApiKey(),
        webhookSigningSecret: generateWebhookSecret(),
        vapidPublicKey: vapidKeys.publicKey,
        vapidPrivateKey: vapidKeys.privateKey,
      },
    });
  } catch {
    // Lost a race to create the singleton row — read back whichever request won.
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    if (settings) return backfillVapidKeys(settings);
    throw new Error('Failed to load or create app settings');
  }
}

/**
 * Settings rows created before the "Push" integration channel existed won't
 * have a VAPID key pair yet — generate and persist one lazily the first time
 * it's needed, instead of requiring a migration data-fix.
 */
async function backfillVapidKeys<T extends { id: string; vapidPublicKey: string | null; vapidPrivateKey: string | null }>(
  settings: T,
): Promise<T> {
  if (settings.vapidPublicKey && settings.vapidPrivateKey) return settings;

  const vapidKeys = webpush.generateVAPIDKeys();
  return prisma.appSettings.update({
    where: { id: settings.id },
    data: { vapidPublicKey: vapidKeys.publicKey, vapidPrivateKey: vapidKeys.privateKey },
  }) as Promise<T>;
}
