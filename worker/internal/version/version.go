// Package version reports which build is running — the Go counterpart of
// src/lib/version.ts.
//
// The values come from STAYUP_BUILD_VERSION/STAYUP_BUILD_REVISION, which the
// Dockerfile sets from the BUILD_VERSION/BUILD_REVISION build args that
// .gitlab-ci.yml fills with the git tag (or commit short SHA) and the full
// commit SHA. A `go run ./cmd/janitor` from a checkout has neither, and
// reports Unknown — update checks then have nothing to compare against.
package version

import (
	"os"
	"strings"
)

// Unknown is the version/revision of a build that CI didn't stamp.
const Unknown = "dev"

func Current() string {
	if v := strings.TrimSpace(os.Getenv("STAYUP_BUILD_VERSION")); v != "" {
		return v
	}
	return Unknown
}

func Revision() string {
	if v := strings.TrimSpace(os.Getenv("STAYUP_BUILD_REVISION")); v != "" {
		return v
	}
	return Unknown
}
