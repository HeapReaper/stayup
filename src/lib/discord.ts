import { logger } from '@/lib/logging';

/** Posts a plain-content message to a Discord incoming webhook URL. */
export async function sendDiscordWebhook(webhookUrl: string, content: string) {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      logger.error(`[Discord] Webhook post failed with status ${response.status}`);
      return { success: false };
    }

    return { success: true };
  } catch (error) {
    logger.error(`[Discord] Webhook post failed with error: ${error}`);
    return { success: false, error };
  }
}
