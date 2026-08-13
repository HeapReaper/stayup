// Command https is the standalone worker that periodically checks every
// HTTP(s) monitor — mirrors src/workers/https.ts. It's a separate
// long-running process from the Next.js app, not something that runs inside it.
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
	_ = godotenv.Load() // no .env in Docker (env vars are injected directly) — that's fine, ignore a missing file

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	conn, err := db.Open()
	if err != nil {
		logging.Error("[https-worker] Fatal error", err)
		os.Exit(1)
	}
	defer conn.Close()

	runner.Run(ctx, store.New(conn), runner.Options{
		WorkerLabel:  "https-worker",
		MonitorType:  "HTTP",
		PerformCheck: checkers.HTTP,
	})
}
