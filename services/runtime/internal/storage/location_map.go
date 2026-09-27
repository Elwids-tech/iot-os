package storage

import (
	"context"
	"strconv"
	"time"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

// CommittedEvents returns complete committed packets so location parameters are
// always paired by event rather than joined as independent measurement series.
func (s *Store) CommittedEvents(ctx context.Context, org, device string, from, to time.Time, limit int) ([]devices.CommittedTelemetry, bool, error) {
	rows, err := s.Pool.Query(ctx, `SELECT sequence,event FROM device_runtime.telemetry_outbox
	 WHERE organization_uuid=$1 AND event->>'device_uuid'=$2 AND created_at >= $3 AND created_at <= $4
	 ORDER BY sequence DESC LIMIT $5`, org, device, from, to, limit+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	events := make([]devices.CommittedTelemetry, 0, limit+1)
	for rows.Next() {
		var sequence int64
		var raw []byte
		if err = rows.Scan(&sequence, &raw); err != nil {
			return nil, false, err
		}
		var event devices.CommittedTelemetry
		if err = Decode(raw, &event); err != nil {
			return nil, false, err
		}
		event.Sequence = strconv.FormatInt(sequence, 10)
		events = append(events, event)
	}
	if err = rows.Err(); err != nil {
		return nil, false, err
	}
	sampled := len(events) > limit
	if sampled {
		events = events[:limit]
	}
	for left, right := 0, len(events)-1; left < right; left, right = left+1, right-1 {
		events[left], events[right] = events[right], events[left]
	}
	return events, sampled, nil
}
