package checkers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// rdap.org is the IANA-backed bootstrap service: it redirects a domain query
// to whichever registry actually holds the TLD, so one endpoint covers every
// gTLD without this worker shipping a registry table.
const rdapBootstrap = "https://rdap.org/domain/"

// Domain looks a registrable domain up over RDAP and reports how long is left
// on its registration.
//
// This is the certificate-expiry warning one layer down the stack. A lapsed
// domain takes everything with it — the site, the mail, the certificate
// renewal that needed the DNS record — and unlike a certificate nothing
// renews it automatically. The failure mode is a calendar problem, so the
// check is a calendar check: Degraded inside the warning window, Down once
// the date has passed or the domain has stopped resolving in RDAP at all.
func Domain(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	timeout := time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	started := time.Now()
	domain := strings.ToLower(strings.TrimSpace(monitor.URL))

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rdapBootstrap+domain, nil)
	if err != nil {
		return downResult(started, err)
	}
	req.Header.Set("Accept", "application/rdap+json")
	req.Header.Set("User-Agent", "StayUp-Monitor/1.0")

	resp, err := http.DefaultClient.Do(req)
	responseTime := elapsedMs(started)
	if err != nil {
		return downResult(started, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		// The registry has no record of it: expired and released, or never
		// registered. Either way nothing that depends on it works.
		return downMessage(started, fmt.Sprintf("%s is not registered according to RDAP", domain))
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// A rate-limited or broken RDAP server says nothing about the domain,
		// so this must not be reported as an outage of the domain itself.
		return store.CheckResult{
			Status:       "Degraded",
			ResponseTime: responseTime,
			Message:      strPtr(fmt.Sprintf("RDAP lookup failed with HTTP %d — the domain's status is unknown", resp.StatusCode)),
		}
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return downResult(started, err)
	}

	expiresAt, err := parseRDAPExpiry(body)
	if err != nil {
		return store.CheckResult{
			Status:       "Degraded",
			ResponseTime: responseTime,
			Message:      strPtr(err.Error()),
		}
	}

	result := store.CheckResult{Status: "Up", ResponseTime: responseTime, DomainExpiresAt: expiresAt}

	if warning := domainExpiryWarning(cfg, expiresAt); warning != "" {
		if expiresAt != nil && time.Until(*expiresAt) <= 0 {
			result.Status = "Down"
		} else {
			result.Status = "Degraded"
		}
		result.Message = &warning
	} else if responseTime > cfg.LatencyThreshold {
		// An RDAP round trip is a WAN request to a registry, so latency here
		// says nothing about the monitored service. Deliberately not graded.
		result.Status = "Up"
	}

	return result
}

// rdapResponse is the sliver of RFC 9083 this needs: the event list carrying
// the registration's expiry.
type rdapResponse struct {
	Events []struct {
		Action string `json:"eventAction"`
		Date   string `json:"eventDate"`
	} `json:"events"`
}

func parseRDAPExpiry(body []byte) (*time.Time, error) {
	var parsed rdapResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("RDAP response was not valid JSON: %w", err)
	}

	for _, event := range parsed.Events {
		// "expiration" is the RFC 9083 action; some registries also emit the
		// registrar's own wording.
		action := strings.ToLower(event.Action)
		if action != "expiration" && action != "registrar expiration" {
			continue
		}
		for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05Z", "2006-01-02"} {
			if when, err := time.Parse(layout, event.Date); err == nil {
				utc := when.UTC()
				return &utc, nil
			}
		}
		return nil, fmt.Errorf("RDAP reported an unparseable expiry date %q", event.Date)
	}

	// Plenty of ccTLD registries (.nl among them) publish no expiry at all.
	// That is not an outage — the check passes, it just cannot warn.
	return nil, nil
}

// domainExpiryWarning mirrors certExpiryWarning() for registry expiry.
func domainExpiryWarning(cfg settings.Settings, expiresAt *time.Time) string {
	if !cfg.DomainExpiryWarningEnabled || expiresAt == nil {
		return ""
	}

	remaining := time.Until(*expiresAt)
	if remaining <= 0 {
		return fmt.Sprintf("Domain registration expired on %s", expiresAt.Format("2006-01-02"))
	}

	days := int(remaining.Hours() / 24)
	if days > cfg.DomainExpiryWarningDays {
		return ""
	}
	if days == 0 {
		return fmt.Sprintf("Domain registration expires today (%s)", expiresAt.Format("2006-01-02"))
	}
	return fmt.Sprintf("Domain registration expires in %d day(s), on %s", days, expiresAt.Format("2006-01-02"))
}
