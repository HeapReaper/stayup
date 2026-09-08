// Package procstat reads this process's own memory footprint, for the
// `memoryKb` column of the heartbeat every worker upserts on each tick
// (internal/store's RecordHeartbeat).
//
// Like the heartbeat itself it has no TypeScript mirror: the Next.js app
// reports its own footprint directly in src/lib/workers.ts's
// getAppProcessStatus(), because the process answering that query *is* the
// one being measured and so needs no row to go through.
//
// Self-reporting rather than asking Docker: reading container stats would
// mean handing every worker the Docker socket — root on the host — to
// discover a number the process already knows about itself.
package procstat

import (
	"os"
	"runtime"
	"strconv"
	"strings"
)

// ResidentKB is the process's resident set size in kibibytes — the number
// `docker stats` and `top` show, and the one that answers "how much RAM is
// this worker actually using". Go's own runtime.MemStats can't answer that:
// it accounts for the heap the runtime manages, not for pages the OS has
// actually given this process.
//
// Zero means "unknown", which the dashboard renders as no figure at all
// rather than as 0 MB.
func ResidentKB() int {
	if kb, ok := residentFromProc(); ok {
		return kb
	}
	return residentFallback()
}

// residentFromProc reads /proc/self/statm, whose second field is the resident
// set in pages. This is the real answer, and it is what every deployment gets:
// the workers ship as Linux containers.
func residentFromProc() (int, bool) {
	raw, err := os.ReadFile("/proc/self/statm")
	if err != nil {
		return 0, false
	}

	fields := strings.Fields(string(raw))
	if len(fields) < 2 {
		return 0, false
	}

	pages, err := strconv.Atoi(fields[1])
	if err != nil {
		return 0, false
	}

	return pages * os.Getpagesize() / 1024, true
}

// residentFallback is for a developer running a worker straight on macOS or
// Windows, where there is no /proc. Sys is what the runtime has reserved from
// the OS — reliably an over-estimate of RSS, but a number in the right
// ballpark beats a blank card on the machine where you're debugging.
func residentFallback() int {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return int(stats.Sys / 1024)
}
