// Browser/mobile web push delivery for the "Push" integration channel (see
// src/lib/integration-delivery.ts). A push "target" is a JSON-stringified
// PushSubscription ({ endpoint, keys: { p256dh, auth } }) captured in the
// browser by integrations-client.tsx and handled on the receiving end by
// public/sw.js.
import webpush from 'web-push';
import { logger } from '@/lib/logging';
import { getSettings } from '@/lib/settings';

export interface PushPayload {
  title: string;
  body: string;
}

export class InvalidPushSubscriptionError extends Error {}

/** Sends a single push notification. Throws InvalidPushSubscriptionError for a dead/unsubscribed endpoint (410/404) so callers can drop it. */
export async function sendPushNotification(subscriptionJson: string, payload: PushPayload): Promise<void> {
  const settings = await getSettings();

  if (!settings.vapidPublicKey || !settings.vapidPrivateKey) {
    throw new Error('VAPID keys are not configured');
  }

  let subscription: webpush.PushSubscription;
  try {
    subscription = JSON.parse(subscriptionJson);
  } catch {
    throw new InvalidPushSubscriptionError('Stored push subscription is not valid JSON');
  }

  webpush.setVapidDetails(
    `mailto:${settings.supportEmail || 'admin@example.com'}`,
    settings.vapidPublicKey,
    settings.vapidPrivateKey,
  );

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      throw new InvalidPushSubscriptionError('Push subscription is no longer valid');
    }
    logger.error('[Push] Delivery failed', error);
    throw error;
  }
}
