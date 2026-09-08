// Package updates mirrors src/lib/updates.ts: asks the GitLab API whether a
// newer StayUp has been published and records the answer on the singleton
// app_settings row.
//
// The dashboard's "Check now" button runs the TypeScript copy; cmd/janitor
// runs this one once a day. Both write the same columns from the same
// responses — see invariant 1 in AGENTS.md — and neither installs anything: a
// container can't replace its own image, so the result is only ever reported.
//
// Which comparison applies follows the shape of the running build's version,
// because an image tag is all a container knows about itself: a release tag
// ("v1.4.0") is compared against the project's newest release, a commit short
// SHA (what `latest` is stamped with) against the newest commit on the
// default branch, and an unstamped "dev" build against nothing at all.
package updates

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"stayup/worker/internal/store"
	"stayup/worker/internal/version"
)

// Channel is which of the two comparisons a build is eligible for. Derived
// from the version string, never configured.
type Channel string

const (
	// ChannelRelease: pinned to a release tag, compare against the newest release.
	ChannelRelease Channel = "release"
	// ChannelEdge: tracking `latest`, compare against the newest commit.
	ChannelEdge Channel = "edge"
	// ChannelUnknown: not stamped by CI; nothing to compare.
	ChannelUnknown Channel = "unknown"
)

// requestTimeout caps a whole check. The answer is never urgent enough for
// the janitor's daily pass to sit on a hung connection.
const requestTimeout = 10 * time.Second

var (
	semverRe = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$`)
	shaRe    = regexp.MustCompile(`^[0-9a-fA-F]{7,40}$`)
)

// Semver is a release tag broken into its comparable parts.
type Semver struct {
	Major, Minor, Patch int
	Prerelease          string
}

// projectAPI is the GitLab REST project endpoint releases are published from,
// overridable so a fork (or a self-hosted GitLab) can be tracked instead.
// Same env vars, same defaults as src/lib/updates.ts.
func projectAPI() string {
	if v := strings.TrimSpace(os.Getenv("STAYUP_UPDATE_PROJECT_API")); v != "" {
		return v
	}
	return "https://gitlab.com/api/v4/projects/HeapReaper%2Fstayup"
}

func projectWeb() string {
	if v := strings.TrimSpace(os.Getenv("STAYUP_UPDATE_WEB_URL")); v != "" {
		return v
	}
	return "https://gitlab.com/HeapReaper/stayup"
}

func defaultBranch() string {
	if v := strings.TrimSpace(os.Getenv("STAYUP_UPDATE_BRANCH")); v != "" {
		return v
	}
	return "main"
}

// ParseSemver mirrors parseSemver() in src/lib/updates.ts.
func ParseSemver(value string) (Semver, bool) {
	match := semverRe.FindStringSubmatch(strings.TrimSpace(value))
	if match == nil {
		return Semver{}, false
	}

	major, err := strconv.Atoi(match[1])
	if err != nil {
		return Semver{}, false
	}
	minor, err := strconv.Atoi(match[2])
	if err != nil {
		return Semver{}, false
	}
	patch, err := strconv.Atoi(match[3])
	if err != nil {
		return Semver{}, false
	}
	return Semver{Major: major, Minor: minor, Patch: patch, Prerelease: match[4]}, true
}

// CompareSemver mirrors compareSemver(): numeric fields first, then "a
// prerelease sorts below the release it precedes" (1.4.0-rc.1 < 1.4.0), then a
// plain string compare between prerelease identifiers.
func CompareSemver(a, b Semver) int {
	if a.Major != b.Major {
		return a.Major - b.Major
	}
	if a.Minor != b.Minor {
		return a.Minor - b.Minor
	}
	if a.Patch != b.Patch {
		return a.Patch - b.Patch
	}
	if a.Prerelease == b.Prerelease {
		return 0
	}
	if a.Prerelease == "" {
		return 1
	}
	if b.Prerelease == "" {
		return -1
	}
	return strings.Compare(a.Prerelease, b.Prerelease)
}

// ChannelFor mirrors channelFor().
func ChannelFor(v string) Channel {
	if _, ok := ParseSemver(v); ok {
		return ChannelRelease
	}
	if shaRe.MatchString(strings.TrimSpace(v)) {
		return ChannelEdge
	}
	return ChannelUnknown
}

// IsNewer mirrors isNewer(): only ever compares like with like. Two SHAs
// can't be ordered, but the edge check only records the newest commit on the
// branch, so any difference means the branch has moved on. Anything else — a
// tag against a SHA, or either against "dev" — isn't a comparison, and
// answering false keeps a locally built image from nagging about a release it
// may already contain.
func IsNewer(candidate, current string) bool {
	if candidate == "" {
		return false
	}

	candidateSemver, candidateOK := ParseSemver(candidate)
	currentSemver, currentOK := ParseSemver(current)
	if candidateOK && currentOK {
		return CompareSemver(candidateSemver, currentSemver) > 0
	}

	if shaRe.MatchString(candidate) && shaRe.MatchString(current) {
		// Compare on the shorter of the two: CI stamps images with a short
		// SHA while the API hands back 8 or 40 characters depending on the
		// endpoint.
		length := min(len(candidate), len(current))
		return !strings.EqualFold(candidate[:length], current[:length])
	}

	return false
}

// remoteVersion is one release/commit as the GitLab API described it.
type remoteVersion struct {
	Version     string
	URL         *string
	PublishedAt *time.Time
}

func fetchJSON(ctx context.Context, endpoint string, into any) error {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("updates: build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("updates: get %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("updates: %s returned status %d", endpoint, resp.StatusCode)
	}

	if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
		return fmt.Errorf("updates: decode %s: %w", endpoint, err)
	}
	return nil
}

func parseTime(value string) *time.Time {
	if value == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil
	}
	return &parsed
}

func ptr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

type gitlabRelease struct {
	TagName    string `json:"tag_name"`
	ReleasedAt string `json:"released_at"`
	Links      struct {
		Self string `json:"self"`
	} `json:"_links"`
}

type gitlabTag struct {
	Name   string `json:"name"`
	Commit struct {
		CreatedAt string `json:"created_at"`
	} `json:"commit"`
}

type gitlabCommit struct {
	ID        string `json:"id"`
	ShortID   string `json:"short_id"`
	CreatedAt string `json:"created_at"`
	WebURL    string `json:"web_url"`
}

// highestSemver picks the newest non-prerelease version — someone running
// v1.4.0 shouldn't be pointed at v1.5.0-rc.1.
func highestSemver(candidates []remoteVersion) *remoteVersion {
	var best *remoteVersion
	var bestSemver Semver

	for i := range candidates {
		semver, ok := ParseSemver(candidates[i].Version)
		if !ok || semver.Prerelease != "" {
			continue
		}
		if best == nil || CompareSemver(semver, bestSemver) > 0 {
			best = &candidates[i]
			bestSemver = semver
		}
	}
	return best
}

// fetchLatestRelease mirrors fetchLatestRelease(): releases first, then the
// plain tag list, because a tagged pipeline publishes images whether or not
// anyone wrote release notes for that tag.
func fetchLatestRelease(ctx context.Context) (*remoteVersion, error) {
	var releases []gitlabRelease
	if err := fetchJSON(ctx, projectAPI()+"/releases?per_page=20", &releases); err != nil {
		return nil, err
	}

	candidates := make([]remoteVersion, 0, len(releases))
	for _, release := range releases {
		candidates = append(candidates, remoteVersion{
			Version:     release.TagName,
			URL:         ptr(release.Links.Self),
			PublishedAt: parseTime(release.ReleasedAt),
		})
	}
	if best := highestSemver(candidates); best != nil {
		return best, nil
	}

	var tags []gitlabTag
	if err := fetchJSON(ctx, projectAPI()+"/repository/tags?per_page=50", &tags); err != nil {
		return nil, err
	}

	candidates = candidates[:0]
	for _, tag := range tags {
		var link string
		if tag.Name != "" {
			link = projectWeb() + "/-/tags/" + url.PathEscape(tag.Name)
		}
		candidates = append(candidates, remoteVersion{
			Version:     tag.Name,
			URL:         ptr(link),
			PublishedAt: parseTime(tag.Commit.CreatedAt),
		})
	}
	return highestSemver(candidates), nil
}

// fetchLatestCommit mirrors fetchLatestCommit(): the newest commit on the
// branch `latest` is built from.
func fetchLatestCommit(ctx context.Context) (*remoteVersion, error) {
	var commits []gitlabCommit
	endpoint := fmt.Sprintf("%s/repository/commits?ref_name=%s&per_page=1", projectAPI(), url.QueryEscape(defaultBranch()))
	if err := fetchJSON(ctx, endpoint, &commits); err != nil {
		return nil, err
	}
	if len(commits) == 0 {
		return nil, nil
	}

	commit := commits[0]
	version := commit.ShortID
	if version == "" && len(commit.ID) >= 8 {
		version = commit.ID[:8]
	}
	if version == "" {
		return nil, nil
	}

	return &remoteVersion{
		Version:     version,
		URL:         ptr(commit.WebURL),
		PublishedAt: parseTime(commit.CreatedAt),
	}, nil
}

// Result is what one check found, for the caller to log.
type Result struct {
	// LatestVersion is the newest version published, empty if the check failed.
	LatestVersion string
	// Available is whether that version is newer than the running build.
	// Recomputed on read by the dashboard (src/lib/updates.ts) rather than
	// stored, so pulling the new image clears it without another check.
	Available bool
}

// Check performs one update check and persists the outcome — including a
// failure, so the Updates tab can say "the last check failed" instead of
// presenting a stale latestVersion as current. Mirrors checkForUpdates().
//
// The returned error is only for logging: the outcome has already been
// recorded by the time it comes back.
func Check(ctx context.Context, s *store.Store) (Result, error) {
	current := version.Current()
	channel := ChannelFor(current)
	now := time.Now()

	if channel == ChannelUnknown {
		message := fmt.Sprintf("This build isn't stamped with a version (%s), so there is nothing to compare against.", version.Unknown)
		if err := s.SaveUpdateCheckError(ctx, message, now); err != nil {
			return Result{}, err
		}
		return Result{}, fmt.Errorf("updates: %s", message)
	}

	var latest *remoteVersion
	var err error
	if channel == ChannelRelease {
		latest, err = fetchLatestRelease(ctx)
	} else {
		latest, err = fetchLatestCommit(ctx)
	}
	if err == nil && latest == nil {
		err = fmt.Errorf("updates: no releases, tags or commits found for the configured project")
	}

	if err != nil {
		message := err.Error()
		if len(message) > 500 {
			message = message[:500]
		}
		if saveErr := s.SaveUpdateCheckError(ctx, message, now); saveErr != nil {
			return Result{}, saveErr
		}
		return Result{}, err
	}

	if err := s.SaveUpdateCheck(ctx, store.UpdateCheck{
		LatestVersion: latest.Version,
		URL:           latest.URL,
		PublishedAt:   latest.PublishedAt,
		CheckedAt:     now,
	}); err != nil {
		return Result{}, err
	}

	return Result{LatestVersion: latest.Version, Available: IsNewer(latest.Version, current)}, nil
}
