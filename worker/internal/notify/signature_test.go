package notify

import (
	"testing"
	"time"
)

// The signature has to be byte-identical to the one src/lib/webhook-signature.ts
// produces: the "Send test" button signs from there and every real queued
// alert signs from here, and a receiver checking the header must not be able
// to tell the two apart.
//
// The expected value below was generated with the TypeScript half, the way
// AGENTS.md describes verifying a mirror pair:
//
//	node -e "const c=require('node:crypto');
//	  const body=JSON.stringify({subject:'[Investigating] API is down',
//	                             message:'Automatically detected: API is down.'});
//	  console.log('sha256='+c.createHmac('sha256','whsec_0123456789abcdef0123456789abcdef')
//	                          .update(1757000000+'.'+body).digest('hex'))"
func TestSignWebhookPayloadMatchesTypeScript(t *testing.T) {
	const secret = "whsec_0123456789abcdef0123456789abcdef"
	// Exactly what json.Marshal(map[string]string{...}) and JSON.stringify
	// both produce for this payload — the bytes on the wire, not a
	// re-serialization of them.
	body := []byte(`{"subject":"[Investigating] API is down","message":"Automatically detected: API is down."}`)
	const want = "sha256=41bccfe1822335ae92e538cd96146e2e668b143f59d6e550d1547a6f7aa41cb6"

	if got := SignWebhookPayload(secret, body, 1757000000); got != want {
		t.Errorf("SignWebhookPayload() = %q, want %q", got, want)
	}
}

func TestWebhookSignatureHeaders(t *testing.T) {
	at := time.Unix(1757000000, 0)
	headers := WebhookSignatureHeaders("whsec_test", []byte(`{"a":1}`), at)

	if headers[TimestampHeader] != "1757000000" {
		t.Errorf("%s = %q, want %q", TimestampHeader, headers[TimestampHeader], "1757000000")
	}
	// The timestamp is signed as well as sent: a receiver that only checked
	// the body could not tell a fresh alert from one replayed off a proxy log.
	if headers[SignatureHeader] != SignWebhookPayload("whsec_test", []byte(`{"a":1}`), 1757000000) {
		t.Errorf("%s does not match SignWebhookPayload for the same timestamp", SignatureHeader)
	}
	if headers[SignatureHeader] == SignWebhookPayload("whsec_test", []byte(`{"a":1}`), 1757000001) {
		t.Error("signature is independent of the timestamp — replay protection is not in effect")
	}
}
