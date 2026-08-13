package notify

import (
	"encoding/json"
	"errors"
	"fmt"

	webpush "github.com/SherClockHolmes/webpush-go"

	"stayup/worker/internal/logging"
)

// ErrInvalidPushSubscription mirrors InvalidPushSubscriptionError in
// src/lib/push.ts — a dead/unsubscribed endpoint (404/410), so callers can
// drop it instead of retrying.
var ErrInvalidPushSubscription = errors.New("push subscription is no longer valid")

type PushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// SendPushNotification sends a single browser/mobile web push — mirrors
// sendPushNotification() in src/lib/push.ts. subscriptionJSON is the
// Integration's `target`: a JSON-stringified PushSubscription
// ({endpoint, keys:{p256dh,auth}}) captured in the browser.
func SendPushNotification(subscriptionJSON string, payload PushPayload, vapidPublicKey, vapidPrivateKey, supportEmail string) error {
	var sub webpush.Subscription
	if err := json.Unmarshal([]byte(subscriptionJSON), &sub); err != nil {
		return fmt.Errorf("%w: stored push subscription is not valid JSON", ErrInvalidPushSubscription)
	}

	if supportEmail == "" {
		supportEmail = "admin@example.com"
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("notify: encode push payload: %w", err)
	}

	resp, err := webpush.SendNotification(body, &sub, &webpush.Options{
		Subscriber:      "mailto:" + supportEmail,
		VAPIDPublicKey:  vapidPublicKey,
		VAPIDPrivateKey: vapidPrivateKey,
		TTL:             30,
	})
	if err != nil {
		logging.Error("[Push] Delivery failed", err)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 || resp.StatusCode == 410 {
		return fmt.Errorf("%w", ErrInvalidPushSubscription)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		err := fmt.Errorf("push endpoint returned status %d", resp.StatusCode)
		logging.Error("[Push] Delivery failed", err)
		return err
	}
	return nil
}
