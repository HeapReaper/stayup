package checkers

import "testing"

// Contains is what every monitor created before assertionType existed carries
// (the column defaults to it), so its behaviour has to be bit-for-bit what
// the old keywordFailure() did.
func TestAssertionContains(t *testing.T) {
	body := `{"status":"healthy","queue":0}`

	tests := []struct {
		name     string
		keyword  string
		inverted bool
		wantFail bool
	}{
		{"present", "healthy", false, false},
		{"absent", "degraded", false, true},
		{"inverted and absent", "degraded", true, false},
		{"inverted and present", "healthy", true, true},
		{"no keyword asserts nothing", "", false, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			failure := assertionFailure(AssertContains, tc.keyword, "", tc.inverted, body)
			if (failure != "") != tc.wantFail {
				t.Errorf("assertionFailure() = %q, wantFail %v", failure, tc.wantFail)
			}
		})
	}
}

func TestAssertionRegex(t *testing.T) {
	body := `{"status":"healthy","version":"2.14.0"}`

	tests := []struct {
		name     string
		pattern  string
		inverted bool
		wantFail bool
	}{
		{"matches", `"status":"(healthy|ok)"`, false, false},
		{"does not match", `"status":"degraded"`, false, true},
		{"anchored digits", `"version":"\d+\.\d+\.\d+"`, false, false},
		{"inverted and absent", `"error"`, true, false},
		{"inverted and present", `healthy`, true, true},
		{"empty pattern asserts nothing", "", false, false},
		// The router rejects these on write, so this only happens to a
		// hand-edited row — it must fail loudly rather than pass silently.
		{"uncompilable pattern fails the check", `([a-z`, false, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			failure := assertionFailure(AssertRegex, tc.pattern, "", tc.inverted, body)
			if (failure != "") != tc.wantFail {
				t.Errorf("assertionFailure() = %q, wantFail %v", failure, tc.wantFail)
			}
		})
	}
}

func TestAssertionJSONPath(t *testing.T) {
	body := `{"status":"ok","db":{"connected":true,"latency":12.5},"nodes":[{"name":"a"},{"name":"b"}],"count":3,"nothing":null}`

	tests := []struct {
		name     string
		path     string
		expected string
		inverted bool
		wantFail bool
	}{
		{"string equals", "$.status", "ok", false, false},
		{"string differs", "$.status", "degraded", false, true},
		{"nested bool", "$.db.connected", "true", false, false},
		{"nested float keeps precision", "$.db.latency", "12.5", false, false},
		{"integer has no trailing zeros", "$.count", "3", false, false},
		{"array index", "$.nodes[0].name", "a", false, false},
		{"bracketed key", `$["status"]`, "ok", false, false},
		{"bare key without $", "status", "ok", false, false},
		{"null literal", "$.nothing", "null", false, false},
		{"blank expectation only asserts the path resolves", "$.db.latency", "", false, false},
		{"missing path fails", "$.missing", "", false, true},
		{"missing path passes when inverted", "$.missing", "", true, false},
		{"index out of range fails", "$.nodes[9].name", "a", false, true},
		{"inverted equality fails when equal", "$.status", "ok", true, true},
		{"inverted equality passes when different", "$.status", "degraded", true, false},
		{"no path asserts nothing", "", "ok", false, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			failure := assertionFailure(AssertJSONPath, tc.expected, tc.path, tc.inverted, body)
			if (failure != "") != tc.wantFail {
				t.Errorf("assertionFailure() = %q, wantFail %v", failure, tc.wantFail)
			}
		})
	}
}

// A JsonPath assertion against a body that isn't JSON is a failed check, not
// a crash — plenty of "health endpoints" answer with an HTML error page.
func TestAssertionJSONPathOnNonJSONBody(t *testing.T) {
	failure := assertionFailure(AssertJSONPath, "ok", "$.status", false, "<html>502 Bad Gateway</html>")
	if failure == "" {
		t.Error("expected a failure message for a non-JSON body")
	}
}

// An unknown assertionType must behave like Contains rather than asserting
// nothing, so a bad value can never silently turn a check green.
func TestAssertionUnknownTypeFallsBackToContains(t *testing.T) {
	if failure := assertionFailure("Nonsense", "healthy", "", false, "degraded"); failure == "" {
		t.Error("expected an unknown assertion type to fall back to Contains")
	}
}

func TestParseJSONPathRejectsUnsupportedSyntax(t *testing.T) {
	for _, path := range []string{"", "$", "$.", "$[", "$[abc]", "$[-1]", `$[""]`} {
		if err := ParseJSONPath(path); err == nil {
			t.Errorf("ParseJSONPath(%q) = nil, want an error", path)
		}
	}
	for _, path := range []string{"$.a", "$.a.b", "$.a[0].b", `$["a"]["b"]`, "a.b"} {
		if err := ParseJSONPath(path); err != nil {
			t.Errorf("ParseJSONPath(%q) = %v, want nil", path, err)
		}
	}
}
