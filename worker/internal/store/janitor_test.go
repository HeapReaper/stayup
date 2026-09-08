package store

import "testing"

// Nearest-rank, so every reported percentile is a response time that was
// actually observed — the property that makes "p95 was 840ms" defensible in
// front of the customer the SLA is with.
func TestPercentilesOf(t *testing.T) {
	tests := []struct {
		name               string
		sorted             []int
		p50, p95, p99, max int
	}{
		{"single sample is every percentile", []int{42}, 42, 42, 42, 42},
		{"two samples", []int{10, 20}, 10, 20, 20, 20},
		{
			"one to one hundred",
			seq(1, 100),
			50, 95, 99, 100,
		},
		{
			// The tail is the whole point: the average here is ~154ms, which
			// says nothing about the 6 requests in 100 that took a second.
			// Exactly 94 samples are fast, so rank 95 lands in the tail.
			"a slow tail moves p95 but not p50",
			append(repeat(100, 94), repeat(1000, 6)...),
			100, 1000, 1000, 1000,
		},
		{
			// One fewer slow sample and rank 95 is still the fast value —
			// nearest-rank reports an observed value, it does not interpolate
			// toward the tail.
			"exactly 95 fast samples keep p95 fast",
			append(repeat(100, 95), repeat(1000, 5)...),
			100, 100, 1000, 1000,
		},
		{"all identical", repeat(7, 50), 7, 7, 7, 7},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := percentilesOf(tc.sorted)
			check := func(label string, got *int, want int) {
				t.Helper()
				if got == nil {
					t.Fatalf("%s = nil, want %d", label, want)
				}
				if *got != want {
					t.Errorf("%s = %d, want %d", label, *got, want)
				}
			}
			check("p50", got.p50, tc.p50)
			check("p95", got.p95, tc.p95)
			check("p99", got.p99, tc.p99)
			check("max", got.max, tc.max)
		})
	}
}

func seq(from, to int) []int {
	out := make([]int, 0, to-from+1)
	for i := from; i <= to; i++ {
		out = append(out, i)
	}
	return out
}

func repeat(value, times int) []int {
	out := make([]int, times)
	for i := range out {
		out[i] = value
	}
	return out
}
