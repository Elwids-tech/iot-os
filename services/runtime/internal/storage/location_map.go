package storage

import (
	"context"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// CommittedEvents returns a device's stored events in a range, oldest first, each
// with all its readings so location parameters are always paired by event rather
// than joined as independent measurement series. sampled says the range held more
// than limit events and only the newest are returned.
func (s *Store) CommittedEvents(ctx context.Context, org, device string, from, to time.Time, limit int) ([]devices.CommittedTelemetry, bool, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+eventColumns+` FROM device_runtime.telemetry_events
	 WHERE organization_uuid=$1 AND device_uuid=$2 AND received_at >= $3 AND received_at <= $4
	 ORDER BY received_at DESC, sequence DESC LIMIT $5`, org, device, from, to, limit+1)
	if err != nil {
		return nil, false, err
	}
	stored, err := scanEvents(rows)
	if err != nil {
		return nil, false, err
	}
	sampled := len(stored) > limit
	if sampled {
		stored = stored[:limit]
	}
	for left, right := 0, len(stored)-1; left < right; left, right = left+1, right-1 {
		stored[left], stored[right] = stored[right], stored[left]
	}
	events, err := s.rebuild(ctx, org, device, stored)
	return events, sampled, err
}
