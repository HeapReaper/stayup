package notify

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"
)

// This file mirrors src/lib/webhook-signature.ts (invariant 1 in AGENTS.md).
//
// Only the generic Webhook channel is signed. Slack, Discord, Telegram and
// PagerDuty are third-party endpoints that authenticate the URL or the token
// itself; a header they don't understand would be noise. A generic webhook
// lands on somebody's own service, which otherwise has no way to tell a real
// alert from a POST by anyone who learned the URL.
//
// The "Send test" button signs from the TypeScript half and real queued
// alerts sign from here, so the two must produce byte-identical headers.

const (
	// SignatureHeader carries a hex HMAC-SHA256, prefixed with the algorithm
	// so the scheme can change later without ambiguity.
	SignatureHeader = "X-StayUp-Signature"
	// TimestampHeader is unix seconds, and is part of what is signed.
	TimestampHeader = "X-StayUp-Timestamp"
)

// signingBase is the exact string that gets signed: "<timestamp>.<body>".
//
// The timestamp is inside the signature rather than beside it because that is
// the point — a receiver that only verified the body could not tell a fresh
// alert from one replayed off a proxy log a week later.
func signingBase(timestamp int64, body []byte) []byte {
	prefix := strconv.FormatInt(timestamp, 10) + "."
	out := make([]byte, 0, len(prefix)+len(body))
	out = append(out, prefix...)
	return append(out, body...)
}

// SignWebhookPayload is the signature for one payload, as it appears in the
// header — mirrors signWebhookPayload().
func SignWebhookPayload(secret string, body []byte, timestamp int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(signingBase(timestamp, body))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// WebhookSignatureHeaders is the header pair to send alongside a signed
// webhook body — mirrors webhookSignatureHeaders(). `body` must be the exact
// bytes that go on the wire.
func WebhookSignatureHeaders(secret string, body []byte, now time.Time) map[string]string {
	timestamp := now.Unix()

	return map[string]string{
		TimestampHeader: fmt.Sprintf("%d", timestamp),
		SignatureHeader: SignWebhookPayload(secret, body, timestamp),
	}
}
