package updates

import "testing"

// The version comparison is the one part of this package with no network in
// it, and the one most likely to drift from its TypeScript twin
// (src/lib/updates.ts) — every case here should behave identically there.

func TestChannelFor(t *testing.T) {
	cases := map[string]Channel{
		"v1.4.0":      ChannelRelease,
		"1.4.0":       ChannelRelease,
		"v1.4.0-rc.1": ChannelRelease,
		"a1b2c3d":     ChannelEdge,
		"3f2a91bc":    ChannelEdge,
		"9f8e7d6c5b4a39281706f5e4d3c2b1a091827364": ChannelEdge,
		"dev":    ChannelUnknown,
		"":       ChannelUnknown,
		"latest": ChannelUnknown,
	}

	for input, want := range cases {
		if got := ChannelFor(input); got != want {
			t.Errorf("ChannelFor(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestIsNewer(t *testing.T) {
	cases := []struct {
		name      string
		candidate string
		current   string
		want      bool
	}{
		{"newer patch", "v1.4.1", "v1.4.0", true},
		{"newer minor", "v1.5.0", "v1.4.9", true},
		{"newer major", "v2.0.0", "v1.9.9", true},
		{"same version", "v1.4.0", "v1.4.0", false},
		{"older version", "v1.3.0", "v1.4.0", false},
		{"tag prefix is optional on either side", "1.4.1", "v1.4.0", true},
		// A prerelease sorts below the release it precedes, both ways round.
		{"release beats its own prerelease", "v1.4.0", "v1.4.0-rc.1", true},
		{"prerelease doesn't beat its release", "v1.4.0-rc.1", "v1.4.0", false},
		{"later prerelease", "v1.4.0-rc.2", "v1.4.0-rc.1", true},
		// Edge channel: SHAs can't be ordered, only compared for equality,
		// and the check only ever records the newest commit on the branch.
		{"different commit", "3f2a91bc", "a1b2c3d4", true},
		{"same commit", "a1b2c3d4", "a1b2c3d4", false},
		{"same commit, different length", "a1b2c3d4e5f6", "a1b2c3d4", false},
		{"same commit, different case", "A1B2C3D4", "a1b2c3d4", false},
		// Never compare across channels, or against an unstamped build:
		// answering "no" is what keeps a locally built image from nagging.
		{"tag against commit", "v1.4.0", "a1b2c3d4", false},
		{"commit against tag", "a1b2c3d4", "v1.4.0", false},
		{"anything against dev", "v1.4.0", "dev", false},
		{"nothing recorded yet", "", "v1.4.0", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsNewer(tc.candidate, tc.current); got != tc.want {
				t.Errorf("IsNewer(%q, %q) = %v, want %v", tc.candidate, tc.current, got, tc.want)
			}
		})
	}
}

func TestHighestSemverSkipsPrereleases(t *testing.T) {
	// Someone running v1.4.0 shouldn't be pointed at a release candidate.
	best := highestSemver([]remoteVersion{
		{Version: "v1.4.0"},
		{Version: "v1.5.0-rc.1"},
		{Version: "v1.3.9"},
		{Version: "not-a-version"},
	})

	if best == nil {
		t.Fatal("highestSemver returned nil, want v1.4.0")
	}
	if best.Version != "v1.4.0" {
		t.Errorf("highestSemver picked %q, want v1.4.0", best.Version)
	}
}

func TestHighestSemverWithoutAnyReleases(t *testing.T) {
	if best := highestSemver([]remoteVersion{{Version: "nightly"}}); best != nil {
		t.Errorf("highestSemver = %+v, want nil", best)
	}
}
