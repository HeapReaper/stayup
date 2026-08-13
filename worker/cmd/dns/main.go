// Command dns is the standalone worker that periodically checks every DNS
// monitor — mirrors src/workers/dns.ts.
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
		logging.Error("[dns-worker] Fatal error", err)
		os.Exit(1)
	}
	defer conn.Close()

	runner.Run(ctx, store.New(conn), runner.Options{
		WorkerLabel:  "dns-worker",
		MonitorType:  "DNS",
		PerformCheck: checkers.DNS,
	})
}
