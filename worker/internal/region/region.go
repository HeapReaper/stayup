// Package region answers two questions every check worker now has to ask:
// where am I checking from, and who am I.
//
// Both exist because of the same change. Until now a check worker was a
// singleton by convention — one `https` container, one `ping` container — and
// `runner.tick` selected every due monitor with no lock at all. Running a
// second replica silently double-checked everything. Once a worker can run in
// more than one place, that has to become explicit: a region says which
// results belong together for consensus, and an instance id says which
// process holds a monitor's lease while it is checking it.
//
// No TypeScript counterpart: nothing in the Next.js app checks monitors.
package region

import (
	"fmt"
	"os"
	"strings"

	"stayup/worker/internal/ids"
)

// Default is the region a worker reports when STAYUP_REGION is unset, which
// is every install that has never thought about regions. Named rather than
// blank so a single-region deployment still has one honest lease row per
// monitor instead of a NULL that has to be special-cased everywhere.
const Default = "default"

// Current is this worker's region, from STAYUP_REGION.
//
// Read on every call rather than cached: it costs nothing, and a cached value
// would make the function untestable without a package-level reset.
func Current() string {
	if value := strings.TrimSpace(os.Getenv("STAYUP_REGION")); value != "" {
		return value
	}
	return Default
}

// instanceID is generated once per process. A restarted worker is deliberately
// a *different* instance: its old leases are then held by an id that no longer
// exists, and expire on their own rather than being silently reclaimed by a
// process that has forgotten what it was doing.
var instanceID = fmt.Sprintf("%s-%s", hostname(), ids.New())

// InstanceID identifies this process for the lease it takes on a monitor. The
// hostname prefix is there for the operator reading a stuck lease out of the
// database — an opaque id answers "is this still mine", a hostname answers
// "which container".
func InstanceID() string {
	return instanceID
}

func hostname() string {
	name, err := os.Hostname()
	if err != nil || name == "" {
		return "worker"
	}
	return name
}

// HeartbeatID is the worker_heartbeat primary key for a binary in a region.
//
// The bare name in the default region, so every existing install keeps the
// row it already has and `EXPECTED_WORKERS` in src/lib/workers.ts keeps
// matching. Outside it, "<worker>@<region>": two `https` workers in Frankfurt
// and Virginia are two processes to report on, not one row they overwrite
// every five seconds.
func HeartbeatID(worker, region string) string {
	if region == "" || region == Default {
		return worker
	}
	return worker + "@" + region
}
