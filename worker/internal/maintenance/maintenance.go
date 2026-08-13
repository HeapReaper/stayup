// Package maintenance mirrors src/lib/maintenance.ts's worker-facing half:
// whether a monitor's failing check should be suppressed because it's
// currently under a scheduled maintenance window.
package maintenance

import (
	"context"
	"time"

	"stayup/worker/internal/store"
)

// IsMonitorUnderMaintenance mirrors isMonitorUnderMaintenance().
func IsMonitorUnderMaintenance(ctx context.Context, s *store.Store, monitorID string) (bool, error) {
	return s.IsMonitorUnderMaintenance(ctx, monitorID, time.Now())
}
