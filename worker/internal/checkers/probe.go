package checkers

import (
	"context"
	"fmt"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// ProbeTypes are the connection-level monitor types cmd/probes owns. Must
// stay in step with PROBE_TYPES in src/trpc/routers/monitor.ts: a type the
// router can create but this list doesn't name is a monitor nothing ever
// checks, which looks exactly like a monitor that has never come up.
var ProbeTypes = []string{"Postgres", "MySQL", "Redis", "SMTP", "IMAP", "gRPC", "WebSocket", "Domain"}

// Probe dispatches to the right checker for the monitor's type. One worker
// runs the whole family rather than eight near-identical containers: they all
// do the same shape of work (open a connection, exchange the minimum that
// proves the service is really answering) and none of them is hot enough to
// need a process of its own.
func Probe(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	switch monitor.Type {
	case "Postgres":
		return Postgres(ctx, cfg, monitor)
	case "MySQL":
		return MySQL(ctx, cfg, monitor)
	case "Redis":
		return Redis(ctx, cfg, monitor)
	case "SMTP":
		return SMTP(ctx, cfg, monitor)
	case "IMAP":
		return IMAP(ctx, cfg, monitor)
	case "gRPC":
		return GRPC(ctx, cfg, monitor)
	case "WebSocket":
		return WebSocket(ctx, cfg, monitor)
	case "Domain":
		return Domain(ctx, cfg, monitor)
	default:
		// Only reachable if ProbeTypes and this switch drift apart. Reporting
		// it as Down (with the reason) beats silently never checking.
		message := fmt.Sprintf("No checker for monitor type %q", monitor.Type)
		return store.CheckResult{Status: "Down", Message: &message}
	}
}
