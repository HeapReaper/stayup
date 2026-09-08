package checkers

import "testing"

func TestAnswersContain(t *testing.T) {
	tests := []struct {
		name     string
		answers  []string
		expected string
		want     bool
	}{
		// An MX answer carries its preference, so the useful assertion is a
		// fragment of the answer rather than the whole of it.
		{"mx host inside a preference-prefixed answer", []string{"10 mail.example.com"}, "mail.example.com", true},
		// Registry answers are fully qualified; what someone types is not.
		{"trailing root label is ignored", []string{"mail.example.com."}, "mail.example.com", true},
		{"case is ignored", []string{"MAIL.EXAMPLE.COM"}, "mail.example.com", true},
		// The SPF case: one include out of a long record.
		{"fragment of a TXT record", []string{"v=spf1 include:_spf.google.com ~all"}, "include:_spf.google.com", true},
		{"matches any answer, not just the first", []string{"10 a.example.com", "20 b.example.com"}, "b.example.com", true},
		{"missing value", []string{"10 a.example.com"}, "b.example.com", false},
		{"no answers", nil, "mail.example.com", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := answersContain(tt.answers, tt.expected); got != tt.want {
				t.Errorf("answersContain(%q, %q) = %v, want %v", tt.answers, tt.expected, got, tt.want)
			}
		})
	}
}

func TestSummarizeCapsLongAnswerSets(t *testing.T) {
	answers := []string{"a", "b", "c", "d", "e", "f", "g"}
	want := "a, b, c, d, e and 2 more"

	if got := summarize(answers); got != want {
		t.Errorf("summarize() = %q, want %q", got, want)
	}
}

func TestLookupRecordsRejectsUnknownType(t *testing.T) {
	if _, err := lookupRecords(t.Context(), "PTR", "example.com"); err == nil {
		t.Fatal("expected an error for a record type no checker implements")
	}
}
