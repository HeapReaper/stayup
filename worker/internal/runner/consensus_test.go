package runner

import "testing"

// The consensus rule decides whether a failure one region can see is a failure
// worth reporting. Both of its softenings exist because the failure mode of
// getting this wrong is *silence* — a monitor that can never alert — so every
// case below is really asking "does this still page when it should".
func TestDecideConsensus(t *testing.T) {
	tests := []struct {
		name      string
		local     string
		required  int
		reporting int
		failing   int
		want      string
		wantReq   int
	}{
		{
			name:  "single region reports its own verdict",
			local: "Down", required: 1, reporting: 1, failing: 1,
			want: "Down", wantReq: 1,
		},
		{
			name:  "one of three regions is not enough",
			local: "Down", required: 2, reporting: 3, failing: 1,
			want: "Up", wantReq: 2,
		},
		{
			name:  "two of three agree, so it is an outage",
			local: "Down", required: 2, reporting: 3, failing: 2,
			want: "Down", wantReq: 2,
		},
		{
			// The footgun this cap exists for: asking for three regions on an
			// install that only runs two would otherwise mean nothing ever
			// alerts, quietly, forever.
			name:  "requirement is capped at the regions actually reporting",
			local: "Down", required: 3, reporting: 2, failing: 2,
			want: "Down", wantReq: 2,
		},
		{
			// A region that has gone quiet stops counting, which drops
			// `reporting` — but the cap must not then let a single surviving
			// region's bad route page everyone. Here one of two still reports
			// and it sees the failure, so it is the whole electorate.
			name:  "a lone surviving region is its own majority",
			local: "Down", required: 2, reporting: 1, failing: 1,
			want: "Down", wantReq: 1,
		},
		{
			name:  "degraded is voted on the same way",
			local: "Degraded", required: 2, reporting: 2, failing: 1,
			want: "Up", wantReq: 2,
		},
		{
			// Nothing has reported inside the window at all. Falling back to
			// this region's own verdict is the alerting direction, and the only
			// one that doesn't depend on a query having returned rows.
			name:  "no regions reporting falls back to this one",
			local: "Down", required: 2, reporting: 0, failing: 0,
			want: "Up", wantReq: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, agreed := decideConsensus(tt.local, tt.required, tt.reporting, tt.failing)
			if got != tt.want {
				t.Errorf("decideConsensus(%q, %d, %d, %d) = %q, want %q",
					tt.local, tt.required, tt.reporting, tt.failing, got, tt.want)
			}
			if agreed.Required != tt.wantReq {
				t.Errorf("required = %d, want %d", agreed.Required, tt.wantReq)
			}
		})
	}
}
