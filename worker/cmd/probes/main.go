// Command probes is the standalone worker for the connection-level monitor
// types: Postgres, MySQL, Redis, SMTP, IMAP, gRPC, WebSocket and Domain.
//
// Unlike the https/port/ping/dns workers it owns more than one monitor type.
// They all perform the same shape of check — open a connection and exchange
// the minimum that proves the service is really answering, rather than merely
// listening — and none is hot enough to deserve its own process, so eight
// near-identical containers would be operational cost for no isolation gain.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"

	"stayup/worker/internal/checkers"
	"stayup/worker/internal/db"
	"stayup/worker/internal/logging"
	"stayup/worker/internal/runner"
	"stayup/worker/internal/store"
)

func main() {
	_ = godotenv.Load()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	conn, err := db.Open()
	if err != nil {
		logging.Error("[probes-worker] Fatal error", err)
		os.Exit(1)
	}
	defer conn.Close()

	runner.Run(ctx, store.New(conn), runner.Options{
		WorkerLabel:  "probes-worker",
		MonitorTypes: checkers.ProbeTypes,
		PerformCheck: checkers.Probe,
	})
}
