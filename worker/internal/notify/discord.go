package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"

	"stayup/worker/internal/logging"
)

// SendDiscordWebhook posts a plain-content message to a Discord incoming
// webhook URL — mirrors sendDiscordWebhook() in src/lib/discord.ts.
func SendDiscordWebhook(webhookURL, content string) error {
	body, err := json.Marshal(map[string]string{"content": content})
	if err != nil {
		return fmt.Errorf("notify: encode discord payload: %w", err)
	}

	resp, err := http.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		logging.Error("[Discord] Webhook post failed with error", err)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		err := fmt.Errorf("discord webhook returned status %d", resp.StatusCode)
		logging.Error(fmt.Sprintf("[Discord] Webhook post failed with status %d", resp.StatusCode), nil)
		return err
	}
	return nil
}
