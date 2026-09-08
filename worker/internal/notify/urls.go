package notify

import (
	"os"
	"strings"
)

// This file mirrors src/lib/urls.ts (invariant 1 in AGENTS.md): links that
// leave the dashboard — in alert e-mails and Discord embeds — have to name
// this instance's public origin, and BETTER_AUTH_URL is the only thing either
// runtime knows about it. A worker has no incoming request to infer it from.
// Keep the fallback in step with the TypeScript half, or an unconfigured
// instance sends two different wrong links depending on which side noticed
// the outage.
const fallbackOrigin = "http://localhost:3000"

// DashboardBaseURL is this instance's public origin, without a trailing slash.
func DashboardBaseURL() string {
	base := strings.TrimSpace(os.Getenv("BETTER_AUTH_URL"))
	if base == "" {
		base = fallbackOrigin
	}
	return strings.TrimRight(base, "/")
}

// IncidentsURL is the dashboard's incident list — where every "view incident"
// link in an alert points.
func IncidentsURL() string {
	return DashboardBaseURL() + "/dashboard/incidents"
}
