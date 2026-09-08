// Signing outgoing generic-Webhook deliveries.
//
// Until now an alert arrived at a customer's endpoint as an unauthenticated
// POST: anyone who learned the URL could post a fake outage, and the receiver
// had no way to tell. AppSettings.webhookSigningSecret existed in the
// database and on the Settings page, and nothing read it.
//
// Only the *generic* Webhook channel is signed. Slack, Discord, Telegram and
// PagerDuty are third-party endpoints with their own authentication (the URL
// or the token is the credential); adding a header they don't understand
// would be noise at best.
//
// Mirrored by worker/internal/notify/signature.go (invariant 1 in AGENTS.md)
// — the "Send test" button signs from here, real queued alerts sign from
// there, and a receiver must not be able to tell them apart.
import crypto from 'node:crypto';

/** Hex HMAC-SHA256, prefixed with the algorithm so the scheme can change later without ambiguity. */
export const SIGNATURE_HEADER = 'X-StayUp-Signature';
/** Unix seconds. Part of what is signed, so it can't be moved without breaking the signature. */
export const TIMESTAMP_HEADER = 'X-StayUp-Timestamp';

/**
 * The exact bytes that get signed: `<timestamp>.<body>`.
 *
 * The timestamp is inside the signature rather than beside it because that is
 * the whole point — a receiver that only verified the body could not tell a
 * fresh alert from one replayed a week later off a proxy log. With the
 * timestamp signed, rejecting anything more than a few minutes old is a
 * one-line check on their side.
 */
function signingBase(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

/** The signature for one payload, as it appears in the header. */
export function signWebhookPayload(secret: string, body: string, timestamp: number): string {
  const digest = crypto.createHmac('sha256', secret).update(signingBase(timestamp, body)).digest('hex');
  return `sha256=${digest}`;
}

/**
 * The headers to send alongside a signed webhook body.
 *
 * `body` must be the exact string that goes on the wire — sign the serialized
 * JSON, not the object, or a receiver re-serializing it will compute a
 * different digest over semantically identical data.
 */
export function webhookSignatureHeaders(secret: string, body: string, now: Date = new Date()): Record<string, string> {
  const timestamp = Math.floor(now.getTime() / 1000);

  return {
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: signWebhookPayload(secret, body, timestamp),
  };
}
