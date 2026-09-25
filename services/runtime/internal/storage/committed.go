package storage

import (
	"context"
	"strconv"

	"github.com/Elwids-tech/iot-os/services/runtime/internal/devices"
)

func (s *Store) CommittedPending(ctx context.Context) ([]devices.CommittedTelemetry, error) {
	rows, err := s.Pool.Query(ctx, "SELECT sequence,event FROM device_runtime.telemetry_outbox WHERE published_at IS NULL ORDER BY sequence LIMIT 100")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []devices.CommittedTelemetry{}
	for rows.Next() {
		var sequence int64
		var raw []byte
		var event devices.CommittedTelemetry
		if err = rows.Scan(&sequence, &raw); err != nil {
			return nil, err
		}
		if err = Decode(raw, &event); err != nil {
			return nil, err
		}
		event.Sequence = strconv.FormatInt(sequence, 10)
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) AckCommitted(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, "UPDATE device_runtime.telemetry_outbox SET published_at=COALESCE(published_at,now()) WHERE telemetry_uuid=$1", id)
	return err
}

type CommittedBacklog struct {
	Pending          int64   `json:"pending"`
	OldestAgeSeconds float64 `json:"oldest_age_seconds"`
}

func (s *Store) CommittedBacklog(ctx context.Context) (CommittedBacklog, error) {
	var result CommittedBacklog
	err := s.Pool.QueryRow(ctx, `SELECT count(*),COALESCE(GREATEST(0,extract(epoch FROM now()-min(created_at))),0)::double precision
	 FROM device_runtime.telemetry_outbox WHERE published_at IS NULL`).Scan(&result.Pending, &result.OldestAgeSeconds)
	return result, err
}
