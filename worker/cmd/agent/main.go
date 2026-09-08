// Command agent is the one binary in this repository that does not run next
// to StayUp. It runs on the machine being watched, reads that machine's own
// CPU, memory, disk and load (internal/hostmetrics), and POSTs them to a
// Server monitor's push URL.
//
// It therefore has no database, no Prisma, no store and no settings: the only
// thing it knows is a URL. That is deliberate — this is the component you ask
// somebody to run on a box you don't own, so it should be readable in one
// sitting and impossible to point at anything but the one endpoint it was
// given.
//
//	agent -url https://status.example.com/api/agent/<token>
//	agent -url $URL -interval 60s -disk /var/lib/docker
//
// Everything can also come from the environment (STAYUP_AGENT_URL,
// STAYUP_AGENT_INTERVAL, STAYUP_AGENT_DISK), which is what a systemd unit or
// a container wants.
//
// A full disk is the classic outage no HTTP check ever sees: the site answers
// 200 right up until the write that fails. Nothing else in StayUp can see it,
// because everything else is looking at the service from the outside.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"stayup/worker/internal/hostmetrics"
)

const (
	// Two seconds of /proc/stat deltas. Long enough that a single busy moment
	// doesn't read as 100%, short enough that the agent is not sleeping for a
	// meaningful slice of its own interval.
	cpuSampleWindow = 2 * time.Second
	// Generous, because the far end may be behind a slow link and a missed
	// report is what marks the monitor down.
	requestTimeout = 30 * time.Second
)

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func main() {
	url := flag.String("url", envOr("STAYUP_AGENT_URL", ""),
		"the Server monitor's push URL, e.g. https://status.example.com/api/agent/<token>")
	interval := flag.Duration("interval", parseDuration(envOr("STAYUP_AGENT_INTERVAL", "60s"), time.Minute),
		"how often to report; keep it at or below the monitor's own interval")
	diskPath := flag.String("disk", envOr("STAYUP_AGENT_DISK", "/"),
		"which filesystem to measure — the mount that fills up first, not always /")
	once := flag.Bool("once", false, "send a single report and exit; for testing the URL")
	flag.Parse()

	if strings.TrimSpace(*url) == "" {
		fmt.Fprintln(os.Stderr, "agent: -url (or STAYUP_AGENT_URL) is required")
		flag.Usage()
		os.Exit(2)
	}

	// Plain log lines to stderr rather than internal/logging: that package
	// writes into logs/ next to the app, which is a directory this machine has
	// no reason to have. Whatever supervises the agent captures stderr.
	logf := func(format string, args ...any) {
		fmt.Fprintf(os.Stderr, "%s [agent] %s\n", time.Now().Format(time.RFC3339), fmt.Sprintf(format, args...))
	}

	if *once {
		if err := report(*url, *diskPath); err != nil {
			logf("report failed: %v", err)
			os.Exit(1)
		}
		logf("reported once to %s", redact(*url))
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logf("started — reporting %s every %s, watching %s", redact(*url), *interval, *diskPath)

	for {
		if err := report(*url, *diskPath); err != nil {
			// Never fatal. A machine that cannot reach StayUp right now is
			// exactly the machine whose next report matters most, and exiting
			// would turn a network blip into a permanently silent agent.
			logf("report failed: %v", err)
		}

		select {
		case <-ctx.Done():
			logf("shutting down")
			return
		case <-time.After(*interval):
		}
	}
}

func report(url, diskPath string) error {
	metrics, err := hostmetrics.Collect(diskPath, cpuSampleWindow)
	if err != nil {
		return err
	}

	body, err := json.Marshal(metrics)
	if err != nil {
		return err
	}

	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: requestTimeout}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 200))
		return fmt.Errorf("%s returned %d: %s", redact(url), response.StatusCode, strings.TrimSpace(string(detail)))
	}
	return nil
}

// redact keeps the token out of the agent's own logs. The URL *is* the
// credential, and this process's stderr often ends up in a shared journal.
func redact(url string) string {
	slash := strings.LastIndex(url, "/")
	if slash < 0 || slash == len(url)-1 {
		return url
	}
	return url[:slash+1] + "…"
}

func parseDuration(raw string, fallback time.Duration) time.Duration {
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
