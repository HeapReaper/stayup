// Delivery logic for the Integrations feature's "Send test" button
// (src/trpc/routers/integration.ts) — delivers immediately, synchronously.
// Queued IntegrationDelivery rows (real alerts) are delivered by the Go
// integrations worker instead (worker/internal/delivery, worker/cmd/integrations)
// — a separate but behaviorally-equivalent port of the same per-channel logic
// this file implements, so a test send and a real alert go out the same way.
import { logger } from '@/lib/logging';
import { sendEmail } from '@/lib/email';
import { sendDiscordWebhook } from '@/lib/discord';
import { sendPushNotification, InvalidPushSubscriptionError } from '@/lib/push';
import IntegrationAlertEmail from '@/emails/integration-alert-email';

// Deliberately not importing the `Integration` model type from
// `@prisma/client` — see src/lib/incidents.ts for why (a minimal local shape
// is more robust than depending on a flat generated type export).
export interface IntegrationRef {
  type: string;
  target: string;
  secret: string | null;
}

export interface DeliveryResult {
  success: boolean;
  error?: string;
}

/** Sends one notification through an Integration. Never throws — always resolves with a result. */
export async function deliverToIntegration(
  integration: IntegrationRef,
  subject: string,
  message: string,
): Promise<DeliveryResult> {
  try {
    switch (integration.type) {
      case 'Discord': {
        const result = await sendDiscordWebhook(integration.target, `**${subject}**\n${message}`);
        return result.success ? { success: true } : { success: false, error: 'Discord webhook request failed' };
      }

      case 'Slack': {
        const response = await fetch(integration.target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `*${subject}*\n${message}` }),
        });
        if (!response.ok) return { success: false, error: `Slack webhook returned ${response.status}` };
        return { success: true };
      }

      case 'Webhook': {
        const response = await fetch(integration.target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, message }),
        });
        if (!response.ok) return { success: false, error: `Webhook returned ${response.status}` };
        return { success: true };
      }

      case 'Telegram': {
        if (!integration.secret) return { success: false, error: 'Missing Telegram bot token' };
        const response = await fetch(`https://api.telegram.org/bot${integration.secret}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: integration.target, text: `${subject}\n${message}` }),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          return { success: false, error: `Telegram API returned ${response.status}: ${body.slice(0, 200)}` };
        }
        return { success: true };
      }

      case 'Email': {
        const result = await sendEmail({
          to: integration.target,
          subject,
          react: IntegrationAlertEmail({ subject, message }),
        });
        return result.success ? { success: true } : { success: false, error: 'Email send failed' };
      }

      case 'Push': {
        try {
          await sendPushNotification(integration.target, { title: subject, body: message });
          return { success: true };
        } catch (error) {
          if (error instanceof InvalidPushSubscriptionError) {
            return { success: false, error: 'This browser subscription is no longer valid — reconnect it' };
          }
          throw error;
        }
      }

      case 'PagerDuty': {
        const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routing_key: integration.target,
            event_action: 'trigger',
            payload: {
              summary: subject,
              source: 'stayup',
              severity: 'critical',
              custom_details: { message },
            },
          }),
        });
        if (!response.ok) return { success: false, error: `PagerDuty API returned ${response.status}` };
        return { success: true };
      }

      default:
        return { success: false, error: `Unknown integration type: ${integration.type}` };
    }
  } catch (error) {
    logger.error(`[Integrations] Delivery to ${integration.type} failed`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
